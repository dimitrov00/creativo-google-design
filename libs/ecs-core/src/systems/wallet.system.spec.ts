import { describe, expect, it } from 'vitest';
import { WalletAction } from '@core/components';
import { CouponGrantId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import {
  type WalletActionsInput,
  WalletSystem,
  type WalletView,
} from './wallet.system';

/*
 * The decisions of `walletHoldings` (which tickets are drawn) and
 * `walletActions` (which discs stand, in their order, and what «Използвай»
 * applies) in libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts,
 * re-stated as booleans, tags and ids — and the store's `rewardsUsable`,
 * which is the same write gate. The discs' ids, glyphs, labels and
 * prominence stay with the presenter's spec.
 */

/** Георги's own card, opened from his visit: he owns it, it stands, the device is online. */
const OWNER: WalletView = {
  isOwner: true,
  visitGone: false,
  online: true,
  paused: false,
};

const PUNCH = CouponGrantId.of('grant-dev-georgi-punch');
const BEARD = CouponGrantId.of('grant-beard');

function discs(edit: Partial<WalletActionsInput> = {}): WalletActionsInput {
  return {
    writable: true,
    pointsOn: true,
    catalogStands: true,
    readyGrantIds: [PUNCH],
    ...edit,
  };
}

describe('the wallet’s disc tags', () => {
  it('pins the tags, in the discs’ order', () => {
    expect(WalletAction).toEqual({
      Use: 'USE',
      Code: 'CODE',
      Catalog: 'CATALOG',
      History: 'HISTORY',
    });
    expect(Object.values(WalletAction)).toEqual([
      'USE',
      'CODE',
      'CATALOG',
      'HISTORY',
    ]);
  });
});

describe('WalletSystem.ticketsShown (wallet.presenter.spec.ts `walletHoldings`)', () => {
  it('draws the owner’s tickets, none for a companion, nor for a paused client', () => {
    expect(WalletSystem.ticketsShown(OWNER)).toBe(true);
    expect(WalletSystem.ticketsShown({ ...OWNER, isOwner: false })).toBe(false);
    expect(WalletSystem.ticketsShown({ ...OWNER, paused: true })).toBe(false);
  });

  it('keeps what is held on show for the read-only ways in', () => {
    expect(WalletSystem.ticketsShown({ ...OWNER, online: false })).toBe(true);
    expect(WalletSystem.ticketsShown({ ...OWNER, visitGone: true })).toBe(true);
  });
});

describe('WalletSystem.writable (the discs that write; the store’s `rewardsUsable`)', () => {
  it('writes for the owner, online, on a visit that stands, unpaused', () => {
    expect(WalletSystem.writable(OWNER)).toBe(true);
  });

  it('writes nothing for a companion, offline, on a gone visit or for a paused client', () => {
    expect(WalletSystem.writable({ ...OWNER, isOwner: false })).toBe(false);
    expect(WalletSystem.writable({ ...OWNER, online: false })).toBe(false);
    expect(WalletSystem.writable({ ...OWNER, visitGone: true })).toBe(false);
    expect(WalletSystem.writable({ ...OWNER, paused: true })).toBe(false);
  });
});

describe('WalletSystem.visitEditable (the visit-write gate; a medal detail’s verb)', () => {
  const CLEAR = { online: true, visitGone: false, paused: false };

  it('edits online, on a visit that stands, for an unpaused client — whoever owns it', () => {
    expect(WalletSystem.visitEditable(CLEAR)).toBe(true);
    const companion: WalletView = { ...OWNER, isOwner: false };
    expect(WalletSystem.visitEditable(companion)).toBe(true);
  });

  it('edits nothing offline, on a gone visit or for a paused client', () => {
    expect(WalletSystem.visitEditable({ ...CLEAR, online: false })).toBe(false);
    expect(WalletSystem.visitEditable({ ...CLEAR, visitGone: true })).toBe(
      false,
    );
    expect(WalletSystem.visitEditable({ ...CLEAR, paused: true })).toBe(false);
  });

  it('is writable’s gate: writable is the owner on an editable visit', () => {
    for (const isOwner of [true, false]) {
      for (const online of [true, false]) {
        for (const visitGone of [true, false]) {
          for (const paused of [true, false]) {
            const view = { isOwner, online, visitGone, paused };
            expect(WalletSystem.writable(view)).toBe(
              isOwner && WalletSystem.visitEditable(view),
            );
          }
        }
      }
    }
  });
});

describe('WalletSystem.actions (wallet.presenter.spec.ts `walletActions`)', () => {
  it('stands the four discs on the owner’s card, «Използвай» naming its one grant', () => {
    expect(WalletSystem.actions(discs())).toEqual({
      actions: [
        WalletAction.Use,
        WalletAction.Code,
        WalletAction.Catalog,
        WalletAction.History,
      ],
      useGrantId: PUNCH,
      useCount: null,
    });
  });

  it('counts the tickets when several are ready, and names none', () => {
    expect(
      WalletSystem.actions(discs({ readyGrantIds: [PUNCH, BEARD] })),
    ).toEqual({
      actions: [
        WalletAction.Use,
        WalletAction.Code,
        WalletAction.Catalog,
        WalletAction.History,
      ],
      useGrantId: null,
      useCount: 2,
    });
  });

  it('stands no «Използвай» once no ticket is ready', () => {
    expect(WalletSystem.actions(discs({ readyGrantIds: [] }))).toEqual({
      actions: [WalletAction.Code, WalletAction.Catalog, WalletAction.History],
      useGrantId: null,
      useCount: null,
    });
  });

  it('stands only the discs that read where nothing can be written', () => {
    for (const view of [
      { ...OWNER, isOwner: false },
      { ...OWNER, online: false },
      { ...OWNER, visitGone: true },
      { ...OWNER, paused: true },
    ]) {
      expect(
        WalletSystem.actions(discs({ writable: WalletSystem.writable(view) })),
      ).toEqual({
        actions: [WalletAction.Catalog, WalletAction.History],
        useGrantId: null,
        useCount: null,
      });
    }
  });

  it('stands the code alone where the points are off, «Използвай» before it while a ticket is ready', () => {
    expect(
      WalletSystem.actions(discs({ pointsOn: false, readyGrantIds: [] }))
        .actions,
    ).toEqual([WalletAction.Code]);
    expect(WalletSystem.actions(discs({ pointsOn: false })).actions).toEqual([
      WalletAction.Use,
      WalletAction.Code,
    ]);
  });

  it('stands «Награди» only while its section stands', () => {
    expect(
      WalletSystem.actions(discs({ catalogStands: false })).actions,
    ).toEqual([WalletAction.Use, WalletAction.Code, WalletAction.History]);
    // Points off: the catalogue's section never stands for the discs.
    expect(
      WalletSystem.actions(
        discs({ pointsOn: false, catalogStands: true, readyGrantIds: [] }),
      ).actions,
    ).toEqual([WalletAction.Code]);
  });

  it('names a grant or counts them, never both, and only on «Използвай»', () => {
    for (const readyGrantIds of [[], [PUNCH], [PUNCH, BEARD]]) {
      for (const writable of [true, false]) {
        const answer = WalletSystem.actions(discs({ readyGrantIds, writable }));
        if (answer.actions.includes(WalletAction.Use)) {
          expect(answer.useGrantId === null).not.toBe(answer.useCount === null);
        } else {
          expect([answer.useGrantId, answer.useCount]).toEqual([null, null]);
        }
      }
    }
  });
});

describe('WalletSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const view = deepFreeze({ ...OWNER });
    const input = deepFreeze(discs({ readyGrantIds: [PUNCH, BEARD] }));
    const run = () => [
      WalletSystem.ticketsShown(view),
      WalletSystem.writable(view),
      WalletSystem.visitEditable(view),
      WalletSystem.actions(input),
    ];
    expect(run()).toEqual(run());
    expect(input.readyGrantIds).toEqual([PUNCH, BEARD]);
  });
});
