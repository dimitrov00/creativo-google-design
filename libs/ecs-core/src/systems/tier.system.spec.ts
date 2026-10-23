import { describe, expect, it } from 'vitest';
import {
  Metric,
  TierOverride,
  TierPlateState,
  type TierState,
} from '@core/components';
import type { TierDefinition } from '@core/entities';
import { AdjustmentId, TierId } from '@core/primitives';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import { TierSystem } from './tier.system';

/*
 * COPIED, never moved:
 * - the `tierSteps` cases of the legacy engagement `standing.spec.ts` (deleted
 *   in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1)
 *   (→ `TierSystem.steps`);
 * - the ring and gauge math of the `walletTierVm` cases of
 *   libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts
 *   (→ `TierSystem.progress`): the numbers each case asserts, the words
 *   staying with the presenter's spec. The flag/catalogue absence case is
 *   the presenter's own (no math) and stays there.
 */

const text = (bg: string) => ({ bg, en: bg });

const tier = (id: string, rank: number, atLeast: number): TierDefinition => ({
  id: TierId.of(id),
  name: text(id),
  rank,
  benefits: [],
  version: 1,
  effectiveFromLocalDate: localDate('2025-03-01'),
  qualifyMetric: Metric.VisitsCompleted,
  qualifyAtLeast: atLeast,
  qualifyWindowDays: 365,
});

/** By rank: bronze 0, silver 6, gold 12, platinum 20 — the seed's tiers. */
const TIERS = [
  tier('bronze', 0, 0),
  tier('silver', 1, 6),
  tier('gold', 2, 12),
  tier('platinum', 3, 20),
];

/** Георги: gold on 14 visits, six to platinum. */
const state: TierState = {
  tierId: TierId.of('gold'),
  tierDefinitionVersion: 1,
  tierSinceUtcMs: utcMs('2026-05-10T07:00:00.000Z'),
  tierQualifying: 14,
  nextTierId: TierId.of('platinum'),
  tierRemaining: 6,
  ...TierOverride.none(),
};

describe('TierSystem.steps (standing.spec.ts `tierSteps`)', () => {
  it('draws every tier by rank, with the account’s own figures', () => {
    const track = TierSystem.steps(state, TIERS);
    expect(track.steps.map((s) => `${s.tierId}@${s.atLeast}`)).toEqual([
      'bronze@0',
      'silver@6',
      'gold@12',
      'platinum@20',
    ]);
    expect(track.steps[2]?.name.bg).toBe('gold');
    expect(track).toMatchObject({
      value: 14,
      currentTierId: 'gold',
      nextTierId: 'platinum',
      remaining: 6,
    });
  });

  it('sorts tiers handed over in any order', () => {
    const shuffled = [...TIERS].reverse();
    expect(TierSystem.steps(state, shuffled).steps[0]?.tierId).toBe('bronze');
  });

  it('honours an override for the current step', () => {
    const granted = TierSystem.steps(
      {
        ...state,
        ...TierOverride.adjustment(
          TierId.of('platinum'),
          localDate('2026-12-31'),
          AdjustmentId.of('adj-1'),
        ),
      },
      TIERS,
    );
    expect(granted.currentTierId).toBe('platinum');
  });
});

describe('TierSystem.progress (wallet.presenter.spec.ts `walletTierVm`)', () => {
  it('holds what remains in the ring, from the tier the account stands on to the next', () => {
    expect(TierSystem.progress(state, TIERS)).toEqual({
      currentTierId: 'gold',
      nextTierId: 'platinum',
      value: 14,
      // The steps' gauge: 14 of 20.
      gaugeValue: 14,
      top: 20,
      remaining: 6,
      // Gold (12) to platinum (20): 2 of 8.
      ringValue: 2,
      ringMax: 8,
      atTop: false,
      currentAtLeast: 12,
      nextAtLeast: 20,
    });
  });

  it('fills the ring at the top', () => {
    const top = TierSystem.progress(
      {
        ...state,
        tierId: TierId.of('platinum'),
        tierQualifying: 24,
        nextTierId: null,
        tierRemaining: null,
      },
      TIERS,
    );
    expect(top).toMatchObject({
      ringValue: 1,
      ringMax: 1,
      remaining: null,
      atTop: true,
      // The gauge holds at its top, 20 of 20.
      gaugeValue: 20,
      top: 20,
      currentAtLeast: 20,
      nextAtLeast: null,
    });
  });

  it('starts the ring empty on the first tier, and agrees a count of one', () => {
    expect(
      TierSystem.progress(
        {
          ...state,
          tierId: TierId.of('bronze'),
          tierQualifying: 1,
          nextTierId: TierId.of('silver'),
          tierRemaining: 5,
        },
        TIERS,
      ),
    ).toMatchObject({ ringValue: 1, ringMax: 6, remaining: 5, value: 1 });
  });

  it('never runs the arc backwards under an override that stands above the visits', () => {
    const progress = TierSystem.progress(
      {
        ...state,
        tierId: TierId.of('silver'),
        tierQualifying: 7,
        nextTierId: TierId.of('platinum'),
        tierRemaining: 13,
        ...TierOverride.adjustment(
          TierId.of('gold'),
          null,
          AdjustmentId.of('adj-1'),
        ),
      },
      TIERS,
    );
    expect(progress).toMatchObject({
      ringValue: 0,
      ringMax: 8,
      remaining: 13,
      gaugeValue: 7,
    });
  });

  it('works out what remains where the account does not say, never below nothing', () => {
    expect(
      TierSystem.progress({ ...state, tierRemaining: null }, TIERS),
    ).toMatchObject({ remaining: 6, ringValue: 2 });
    expect(
      TierSystem.progress(
        { ...state, tierQualifying: 25, tierRemaining: null },
        TIERS,
      ),
    ).toMatchObject({ remaining: 0, ringValue: 8, gaugeValue: 20 });
  });

  it('holds a track with no tiers to a gauge of one', () => {
    expect(TierSystem.progress(state, [])).toMatchObject({
      top: 1,
      gaugeValue: 1,
      atTop: true,
      currentAtLeast: null,
    });
  });
});

const adjusted = (tierId: string) =>
  TierOverride.adjustment(TierId.of(tierId), null, AdjustmentId.of('adj-1'));

describe('TierSystem.standingTier (wallet.presenter.spec.ts `passVm` plate, `walletTierVm`)', () => {
  it('stands on the computed tier, or the one an override grants', () => {
    expect(TierSystem.standingTier(state, TIERS)).toBe('gold');
    expect(
      TierSystem.standingTier({ ...state, ...adjusted('platinum') }, TIERS),
    ).toBe('platinum');
  });

  it('stands on nothing while the catalogue holds no tiers', () => {
    expect(TierSystem.standingTier(state, [])).toBeNull();
    expect(
      TierSystem.standingTier({ ...state, ...adjusted('platinum') }, []),
    ).toBeNull();
  });
});

describe('TierSystem.keptAt (wallet.presenter.spec.ts `walletTierVm` at the top)', () => {
  it('keeps the status with the threshold of the tier the account stands on', () => {
    const top = TierSystem.progress(
      {
        ...state,
        tierId: TierId.of('platinum'),
        tierQualifying: 24,
        nextTierId: null,
        tierRemaining: null,
      },
      TIERS,
    );
    expect(top.atTop).toBe(true);
    expect(TierSystem.keptAt(top)).toBe(20);
  });

  it('falls back to the visits when the track does not hold the tier', () => {
    const lost = TierSystem.progress(
      { ...state, tierId: TierId.of('diamond'), nextTierId: null },
      TIERS,
    );
    expect(lost.currentAtLeast).toBeNull();
    expect(TierSystem.keptAt(lost)).toBe(14);
  });
});

describe('TierSystem.plate (glance.presenter.spec.ts the hero’s tier)', () => {
  const plate = (
    edit: Partial<TierState>,
    override: TierOverride = TierOverride.none(),
  ) => TierSystem.plate({ ...state, ...edit, ...override } as TierState, TIERS);

  it('pins the plate tags', () => {
    expect(TierPlateState).toEqual({
      Top: 'TOP',
      HeldAbove: 'HELD_ABOVE',
      Climbing: 'CLIMBING',
    });
  });

  it('climbs from the tier’s own threshold to the next one’s', () => {
    // Gold (12) to platinum (20) on 14 visits: a quarter of the way.
    expect(TierSystem.plate(state, TIERS)).toEqual({
      tierPlateState: TierPlateState.Climbing,
      currentTierId: 'gold',
      nextTierId: 'platinum',
      progress: 0.25,
      remaining: 6,
    });
    expect(plate({ tierQualifying: 19, tierRemaining: 1 })).toMatchObject({
      tierPlateState: TierPlateState.Climbing,
      progress: 0.875,
      remaining: 1,
    });
  });

  it('starts the ring empty at a tier’s own threshold', () => {
    expect(
      plate({
        tierId: TierId.of('bronze'),
        tierQualifying: 0,
        nextTierId: TierId.of('silver'),
        tierRemaining: 6,
      }),
    ).toEqual({
      tierPlateState: TierPlateState.Climbing,
      currentTierId: 'bronze',
      nextTierId: 'silver',
      progress: 0,
      remaining: 6,
    });
  });

  it('works out what remains where the account does not say, clamping the ring and the rest', () => {
    expect(plate({ tierRemaining: null })).toMatchObject({
      progress: 0.25,
      remaining: 6,
    });
    expect(plate({ tierQualifying: 25, tierRemaining: null })).toMatchObject({
      tierPlateState: TierPlateState.Climbing,
      progress: 1,
      remaining: 0,
    });
    // An override stands the account on Gold above its 7 visits: the ring
    // starts at Gold's own threshold, never below it.
    expect(
      plate(
        {
          tierId: TierId.of('silver'),
          tierQualifying: 7,
          nextTierId: TierId.of('platinum'),
          tierRemaining: 13,
        },
        adjusted('gold'),
      ),
    ).toEqual({
      tierPlateState: TierPlateState.Climbing,
      currentTierId: 'gold',
      nextTierId: 'platinum',
      progress: 0,
      remaining: 13,
    });
  });

  it('is at the top on the last step of the track, an override that grants it included', () => {
    const top = {
      tierPlateState: TierPlateState.Top,
      currentTierId: 'platinum',
      nextTierId: null,
      progress: 1,
      remaining: null,
    };
    expect(
      plate({
        tierId: TierId.of('platinum'),
        tierQualifying: 23,
        nextTierId: null,
        tierRemaining: null,
      }),
    ).toEqual(top);
    // Granted the top tier: the top, whatever the visits say of the next.
    expect(plate({}, adjusted('platinum'))).toEqual(top);
  });

  it('stands alone for a tier no next step climbs above: nothing is promised', () => {
    const held = {
      tierPlateState: TierPlateState.HeldAbove,
      currentTierId: 'gold',
      nextTierId: null,
      progress: null,
      remaining: null,
    };
    // Granted Gold on Silver's visits: the account's next IS Gold.
    expect(
      plate(
        {
          tierId: TierId.of('silver'),
          tierQualifying: 9,
          nextTierId: TierId.of('gold'),
          tierRemaining: 3,
        },
        adjusted('gold'),
      ),
    ).toEqual(held);
    // Granted Gold on Bronze's visits: the account's next (Silver) stands below it.
    expect(
      plate(
        {
          tierId: TierId.of('bronze'),
          tierQualifying: 3,
          nextTierId: TierId.of('silver'),
          tierRemaining: 3,
        },
        adjusted('gold'),
      ),
    ).toEqual(held);
    // A next tier the track does not hold, or none at all, below the top.
    expect(plate({ nextTierId: TierId.of('diamond') })).toEqual(held);
    expect(plate({ nextTierId: null, tierRemaining: null })).toEqual(held);
  });

  it('draws no plate for a tier the track does not hold, nor with no tiers', () => {
    expect(plate({ tierId: TierId.of('diamond') })).toBeNull();
    expect(TierSystem.plate(state, [])).toBeNull();
  });
});

describe('TierSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const tiers = deepFreeze([...TIERS].reverse());
    const held = deepFreeze(state);
    expect(TierSystem.progress(held, tiers)).toEqual(
      TierSystem.progress(held, tiers),
    );
    expect(TierSystem.steps(held, tiers)).toEqual(
      TierSystem.steps(held, tiers),
    );
    expect(TierSystem.plate(held, tiers)).toEqual(
      TierSystem.plate(held, tiers),
    );
    expect(TierSystem.standingTier(held, tiers)).toBe(
      TierSystem.standingTier(held, tiers),
    );
    const progress = deepFreeze(TierSystem.progress(held, tiers));
    expect(TierSystem.keptAt(progress)).toBe(TierSystem.keptAt(progress));
    expect(tiers.map((tier) => tier.id)).toEqual([
      'platinum',
      'gold',
      'silver',
      'bronze',
    ]);
  });
});
