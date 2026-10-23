import { describe, expect, it } from 'vitest';
import { Points, RewardGrantRule, RedeemProblem } from '@core/components';
import type { RewardCatalogItem } from '@core/entities';
import { CouponGrantId, CouponId, RewardId } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import {
  RewardSystem,
  type GrantTicketRef,
  type RedeemContext,
} from './reward.system';

/*
 * COPIED, never moved:
 * - the `redeemProblem`, `bestAffordable` and `nextAffordable` cases of the
 *   legacy engagement `standing.spec.ts` (deleted in Phase 4b; ledger
 *   `docs/architecture/flips/phase-4b-delete.md` §11.1) (→
 *   `RewardSystem.problem`/`bestAffordable`/`nextAffordable`);
 * - the reach math of `rewardTiles` in
 *   libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts
 *   (→ `RewardSystem.affordable`: the verdict, what is missing, the meter;
 *   the words, the covers and the halves' order stay with the presenter);
 * - the ticket grouping of `glanceReward` (loyalty.presenter.spec.ts) and
 *   of `walletHoldings`' «on the bill» case (→ `RewardSystem.groupGrants`).
 */

const TODAY = localDate('2026-09-28');
const text = (bg: string) => ({ bg, en: bg });

const reward = (
  id: string,
  cost: number,
  order: number,
  over: Partial<RewardCatalogItem> = {},
): RewardCatalogItem =>
  ({
    id: RewardId.of(id),
    name: text(id),
    cost: Points.of(cost),
    enabled: true,
    order,
    ...RewardGrantRule.coupon(CouponId.of(`coupon-${id}`)),
    availableFrom: null,
    availableUntil: null,
    perClientLimitCount: null,
    perClientLimitWindowDays: null,
    totalLimit: null,
    redeemedCount: 0,
    ...over,
  }) as RewardCatalogItem;

const day = (raw: string) => localDate(raw);

/** At most `count` per client in `windowDays` (today's `limits.perClient`). */
const perClient = (count: number, windowDays: number) => ({
  perClientLimitCount: count,
  perClientLimitWindowDays: windowDays,
});

describe('RewardSystem.problem (standing.spec.ts `redeemProblem`)', () => {
  const beard = reward('reward-beard', 120, 1, perClient(1, 30));
  const ctx: RedeemContext = {
    balance: 358,
    today: TODAY,
    paused: false,
    recent: [],
  };

  it('lets an affordable, open, stocked reward through', () => {
    expect(RewardSystem.problem(beard, ctx)).toBeNull();
  });

  it.each<[string, RewardCatalogItem, Partial<RedeemContext>, string]>([
    ['switched off', { ...beard, enabled: false }, {}, RedeemProblem.Disabled],
    [
      'not open yet',
      { ...beard, availableFrom: day('2026-10-01'), availableUntil: null },
      {},
      RedeemProblem.NotYetAvailable,
    ],
    [
      'over',
      { ...beard, availableFrom: null, availableUntil: day('2026-09-27') },
      {},
      RedeemProblem.Ended,
    ],
    [
      'sold out',
      {
        ...beard,
        perClientLimitCount: null,
        perClientLimitWindowDays: null,
        totalLimit: 5,
        redeemedCount: 5,
      },
      {},
      RedeemProblem.SoldOut,
    ],
    ['held by a pause', beard, { paused: true }, RedeemProblem.Paused],
    [
      'beyond the balance',
      beard,
      { balance: 119 },
      RedeemProblem.InsufficientPoints,
    ],
    [
      'beyond an owed balance',
      beard,
      { balance: -40 },
      RedeemProblem.InsufficientPoints,
    ],
  ])('refuses a reward %s', (_case, item, over, problem) => {
    expect(RewardSystem.problem(item, { ...ctx, ...over })).toBe(problem);
  });

  it('counts the per-client limit inside its window only', () => {
    const recent = (on: string) => [
      { rewardId: RewardId.of('reward-beard'), on: day(on) },
    ];
    expect(
      RewardSystem.problem(beard, { ...ctx, recent: recent('2026-09-01') }),
    ).toBe(RedeemProblem.PerClientLimit);
    expect(
      RewardSystem.problem(beard, { ...ctx, recent: recent('2026-08-29') }),
    ).toBeNull();
    expect(
      RewardSystem.problem(beard, {
        ...ctx,
        recent: [
          { rewardId: RewardId.of('reward-cut'), on: day('2026-09-20') },
        ],
      }),
    ).toBeNull();
  });
});

describe('RewardSystem.bestAffordable and nextAffordable', () => {
  const rewards = [
    reward('reward-product', 400, 3),
    reward('reward-beard', 120, 1),
    reward('reward-cut', 250, 2),
    reward('reward-off', 100, 4, { enabled: false }),
  ];
  const best = (balance: number) =>
    RewardSystem.bestAffordable(rewards, balance, TODAY)?.id ?? null;
  const next = (balance: number) =>
    RewardSystem.nextAffordable(rewards, balance, TODAY)?.id ?? null;

  it('picks the costliest reward the balance buys, and the cheapest it does not reach', () => {
    expect(best(358)).toBe('reward-cut');
    expect(next(358)).toBe('reward-product');
  });

  it('has nothing to buy on a small balance, and nothing left to reach on a large one', () => {
    expect(best(50)).toBeNull();
    expect(next(50)).toBe('reward-beard');
    expect(best(500)).toBe('reward-product');
    expect(next(500)).toBeNull();
  });

  it('ignores a reward switched off, even when affordable', () => {
    expect(best(110)).toBeNull();
  });

  it('breaks a tie of cost by the catalogue’s order', () => {
    const twins = [reward('b', 100, 2), reward('a', 100, 1)];
    expect(RewardSystem.bestAffordable(twins, 150, TODAY)?.id).toBe('a');
    expect(RewardSystem.nextAffordable(twins, 50, TODAY)?.id).toBe('a');
  });
});

describe('RewardSystem.offered (loyalty.presenter.ts `offered`)', () => {
  it('offers what is switched on and not over, in the order given', () => {
    const rewards = [
      reward('reward-cut', 250, 2),
      reward('reward-off', 100, 4, { enabled: false }),
      reward('reward-over', 100, 5, { availableUntil: day('2026-09-27') }),
      reward('reward-today', 100, 6, { availableUntil: TODAY }),
      // Not open yet is still offered: the tile says when.
      reward('reward-soon', 100, 7, { availableFrom: day('2026-11-01') }),
    ];
    expect(RewardSystem.offered(rewards, TODAY).map((r) => r.id)).toEqual([
      'reward-cut',
      'reward-today',
      'reward-soon',
    ]);
  });
});

describe('RewardSystem.affordable (wallet.presenter.spec.ts `rewardTiles`)', () => {
  const seed = [
    reward('reward-beard', 120, 1),
    reward('reward-cut', 250, 2),
    reward('reward-product', 400, 3),
  ];
  const reach = (balance: number) =>
    seed.map((item) => RewardSystem.affordable(item, balance, TODAY));

  it('covers the rewards the points reach, and meters the ones they do not', () => {
    expect(reach(358)).toEqual([
      { affordable: true, short: 0, progress: null },
      { affordable: true, short: 0, progress: null },
      { affordable: false, short: 42, progress: 0.895 },
    ]);
    expect(reach(130).map((r) => r?.short)).toEqual([0, 120, 270]);
  });

  it('meters from nothing for an account that owes, and never to the full', () => {
    expect(reach(-40).map((r) => [r?.short, r?.progress])).toEqual([
      [160, 0],
      [290, 0],
      [440, 0],
    ]);
    for (const balance of [0, 119, 399, 400, 5000]) {
      for (const tile of reach(balance)) {
        expect(tile).not.toBeNull();
        expect(tile?.progress === null).toBe(tile?.affordable);
        if (tile !== null && tile.progress !== null) {
          expect(tile.progress).toBeGreaterThanOrEqual(0);
          expect(tile.progress).toBeLessThan(1);
        }
      }
    }
  });

  it('draws no tile for a reward nobody can take today', () => {
    expect(
      RewardSystem.affordable(
        reward('reward-beard', 120, 1, { enabled: false }),
        358,
        TODAY,
      ),
    ).toBeNull();
    expect(
      RewardSystem.affordable(
        reward('reward-cut', 250, 2, { availableFrom: day('2026-11-01') }),
        358,
        TODAY,
      ),
    ).toBeNull();
    expect(
      RewardSystem.affordable(
        reward('reward-product', 400, 3, {
          availableUntil: day('2026-09-27'),
        }),
        358,
        TODAY,
      ),
    ).toBeNull();
  });
});

describe('RewardSystem.groupGrants (loyalty.presenter.ts `groupedGrants`)', () => {
  const grant = (
    grantId: string,
    groupKey: string,
    expiresOn: string | null,
  ): GrantTicketRef => ({
    grantId: CouponGrantId.of(grantId),
    groupKey,
    expiresOn: expiresOn === null ? null : day(expiresOn),
  });
  const punch = grant('grant-dev-georgi-punch', 'cut', '2026-10-28');
  const beard = grant('grant-beard', 'beard', null);

  it('puts the soonest to expire first, one that never expires last', () => {
    const tickets = RewardSystem.groupGrants([beard, punch], []);
    expect(tickets.map((t) => t.grants[0]?.grantId)).toEqual([
      'grant-dev-georgi-punch',
      'grant-beard',
    ]);
    expect(tickets.every((t) => !t.applied)).toBe(true);
  });

  it('keeps a ticket on the bill where it stood, the soonest to expire first', () => {
    expect(
      RewardSystem.groupGrants([beard], [punch]).map((t) => [
        t.grants[0]?.grantId,
        t.applied,
      ]),
    ).toEqual([
      ['grant-dev-georgi-punch', true],
      ['grant-beard', false],
    ]);
  });

  it('stacks identical grants into one ticket, the soonest first inside it', () => {
    const later = grant('grant-cut-2', 'cut', '2026-12-01');
    const sooner = grant('grant-cut-1', 'cut', '2026-11-01');
    const tickets = RewardSystem.groupGrants([later, beard, sooner], []);
    expect(tickets.map((t) => t.grants.map((g) => g.grantId))).toEqual([
      ['grant-cut-1', 'grant-cut-2'],
      ['grant-beard'],
    ]);
    expect(RewardSystem.groupGrants([], [])).toEqual([]);
  });

  it('breaks a tie of days by the grant’s id', () => {
    const a = grant('grant-a', 'x', '2026-11-01');
    const b = grant('grant-b', 'y', '2026-11-01');
    expect(
      RewardSystem.groupGrants([b, a], []).map((t) => t.grants[0]?.grantId),
    ).toEqual(['grant-a', 'grant-b']);
  });
});

describe('RewardSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rewards = deepFreeze([
      reward('reward-product', 400, 3),
      reward('reward-beard', 120, 1, perClient(1, 30)),
    ]);
    const grants = deepFreeze([
      {
        grantId: CouponGrantId.of('g2'),
        groupKey: 'k',
        expiresOn: day('2026-12-01'),
      },
      {
        grantId: CouponGrantId.of('g1'),
        groupKey: 'k',
        expiresOn: day('2026-11-01'),
      },
    ]);
    const run = () => [
      RewardSystem.bestAffordable(rewards, 358, TODAY),
      RewardSystem.nextAffordable(rewards, 358, TODAY),
      RewardSystem.offered(rewards, TODAY),
      RewardSystem.affordable(rewards[0] as RewardCatalogItem, 358, TODAY),
      RewardSystem.groupGrants(grants, []),
    ];
    expect(run()).toEqual(run());
  });
});
