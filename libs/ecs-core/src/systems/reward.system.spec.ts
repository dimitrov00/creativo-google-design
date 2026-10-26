import { describe, expect, it } from 'vitest';
import {
  CouponValue,
  Points,
  PointsReach,
  RewardGrantRule,
  RedeemProblem,
} from '@core/components';
import type { RewardCatalogItem } from '@core/entities';
import {
  CouponGrantId,
  CouponId,
  Currency,
  PriceCents,
  RewardId,
} from '@core/primitives';
import { deepFreeze, localDate, unwrapOk } from '@core/testing';
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
 * - the reach math of `walletVm`'s «what the points buy» (WF) in
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

describe('RewardSystem.affordable (wallet.presenter.spec.ts `walletVm` WF)', () => {
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

describe('RewardSystem.tiles (wallet.presenter.spec.ts `walletVm` WF)', () => {
  const beard = reward('reward-beard', 120, 1);
  const cut = reward('reward-cut', 250, 2);
  const product = reward('reward-product', 400, 3);
  const seed = [beard, cut, product];
  const tiles = (rewards: readonly RewardCatalogItem[], balance: number) =>
    RewardSystem.tiles(rewards, balance, TODAY);
  const order = (rewards: readonly RewardCatalogItem[], balance: number) =>
    tiles(rewards, balance).tiles.map((t) => [t.reward.id, t.reach.affordable]);

  it('puts the rewards the points cover first, meters the ones they do not, and counts the covered', () => {
    expect(tiles(seed, 358)).toEqual({
      tiles: [
        {
          reward: beard,
          reach: { affordable: true, short: 0, progress: null },
        },
        { reward: cut, reach: { affordable: true, short: 0, progress: null } },
        {
          reward: product,
          reach: { affordable: false, short: 42, progress: 0.895 },
        },
      ],
      withinReach: 2,
    });
  });

  it('keeps the catalogue’s order inside each half', () => {
    expect(order(seed, 300)).toEqual([
      ['reward-beard', true],
      ['reward-cut', true],
      ['reward-product', false],
    ]);
    expect(
      tiles(seed, 130).tiles.map((t) => [t.reward.id, t.reach.short]),
    ).toEqual([
      ['reward-beard', 0],
      ['reward-cut', 120],
      ['reward-product', 270],
    ]);
    // The order given is the catalogue's, whatever the costs say.
    expect(order([product, cut, beard], 300)).toEqual([
      ['reward-cut', true],
      ['reward-beard', true],
      ['reward-product', false],
    ]);
    expect(order([product, cut, beard], 130)).toEqual([
      ['reward-beard', true],
      ['reward-product', false],
      ['reward-cut', false],
    ]);
  });

  it('meters from nothing for an account that owes, and covers none', () => {
    const owing = tiles(seed, -40);
    expect(owing.withinReach).toBe(0);
    expect(owing.tiles.map((t) => [t.reach.short, t.reach.progress])).toEqual([
      [160, 0],
      [290, 0],
      [440, 0],
    ]);
    expect(tiles(seed, 0).withinReach).toBe(0);
    expect(tiles(seed, 120).withinReach).toBe(1);
    expect(tiles(seed, 5000).withinReach).toBe(3);
  });

  it('judges reach by the points alone: there is no pause to read', () => {
    // A paused client's tiles are the points' (`walletVm` WF paused case).
    expect(order(seed, 358).map(([, affordable]) => affordable)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('draws no tile for a reward nobody can take today, nor for an empty catalogue', () => {
    const none = tiles(
      [
        { ...beard, enabled: false },
        { ...cut, availableFrom: day('2026-11-01'), availableUntil: null },
        { ...product, availableFrom: null, availableUntil: day('2026-09-27') },
        reward('reward-gone', 50, 4, { totalLimit: 3, redeemedCount: 3 }),
      ],
      358,
    );
    expect(none).toEqual({ tiles: [], withinReach: 0 });
    expect(tiles([], 358)).toEqual({ tiles: [], withinReach: 0 });
  });
});

describe('RewardSystem.pointsReach (glance.presenter.spec.ts «Лоялност» F1)', () => {
  const seed = [
    reward('reward-beard', 120, 1),
    reward('reward-cut', 250, 2),
    reward('reward-product', 400, 3),
  ];
  /** The caller's pre-filter: a reward held on this visit is never named. */
  const beyond = (...held: string[]) =>
    seed.filter((item) => !held.includes(item.id));
  const reach = (rewards: readonly RewardCatalogItem[], balance: number) => {
    const answer = RewardSystem.pointsReach(rewards, balance, TODAY);
    return [answer.pointsReach, answer.reward?.id ?? null, answer.short];
  };

  it('pins the reach tags', () => {
    expect(PointsReach).toEqual({
      EnoughFor: 'ENOUGH_FOR',
      MoreTo: 'MORE_TO',
      None: 'NONE',
    });
  });

  it('is enough for the costliest reward in reach, beyond the one in hand', () => {
    expect(reach(beyond('reward-cut'), 358)).toEqual([
      PointsReach.EnoughFor,
      'reward-beard',
      0,
    ]);
    expect(reach(beyond(), 358)).toEqual([
      PointsReach.EnoughFor,
      'reward-cut',
      0,
    ]);
    expect(reach(beyond(), 5000)).toEqual([
      PointsReach.EnoughFor,
      'reward-product',
      0,
    ]);
  });

  it('says how far the next reward is when none is in reach, by exactly what is missing', () => {
    expect(reach(beyond(), 78)).toEqual([
      PointsReach.MoreTo,
      'reward-beard',
      42,
    ]);
    // Everything in reach is in hand: the next one out of reach.
    expect(reach(beyond('reward-cut', 'reward-beard'), 358)).toEqual([
      PointsReach.MoreTo,
      'reward-product',
      42,
    ]);
    // An account that owes is short of the cost and of what it owes.
    expect(reach(beyond(), -40)).toEqual([
      PointsReach.MoreTo,
      'reward-beard',
      160,
    ]);
  });

  it('names nothing when no reward is left to name', () => {
    expect(
      reach(beyond('reward-cut', 'reward-beard', 'reward-product'), 358),
    ).toEqual([PointsReach.None, null, 0]);
    expect(reach([], 0)).toEqual([PointsReach.None, null, 0]);
  });
});

describe('RewardSystem.pointsReachBeyondHeld (glance.presenter.spec.ts «Лоялност» F1, the held rule)', () => {
  const named = (
    id: string,
    cost: number,
    order: number,
    bg: string,
    en: string,
  ) => reward(id, cost, order, { name: { bg, en } });
  const seed = [
    named('reward-cut', 250, 1, 'Безплатно подстригване', 'Free haircut'),
    named(
      'reward-beard',
      120,
      2,
      'Безплатно оформяне на брада',
      'Free beard trim',
    ),
    named('reward-product', 400, 3, 'Продукт по избор', 'Product of choice'),
  ];
  /** The coupon each fixture reward mints — `reward()` names it `coupon-<id>`. */
  const CUT = CouponId.of('coupon-reward-cut');
  const BEARD = CouponId.of('coupon-reward-beard');
  const PRODUCT = CouponId.of('coupon-reward-product');
  const reach = (
    held: readonly CouponId[],
    balance: number,
    rewards: readonly RewardCatalogItem[] = seed,
  ) => {
    const answer = RewardSystem.pointsReachBeyondHeld(
      rewards,
      held,
      balance,
      TODAY,
    );
    return [answer.pointsReach, answer.reward?.id ?? null, answer.short];
  };

  it('never names the reward in hand: the points add the next best', () => {
    expect(reach([CUT], 358)).toEqual([
      PointsReach.EnoughFor,
      'reward-beard',
      0,
    ]);
  });

  it('names the costliest reward in reach when none is in hand', () => {
    expect(reach([], 358)).toEqual([PointsReach.EnoughFor, 'reward-cut', 0]);
  });

  it('says how far the next reward is when everything in reach is in hand', () => {
    expect(reach([CUT, BEARD], 358)).toEqual([
      PointsReach.MoreTo,
      'reward-product',
      42,
    ]);
    expect(reach([], 78)).toEqual([PointsReach.MoreTo, 'reward-beard', 42]);
  });

  it('counts what is owed into what is missing', () => {
    expect(reach([], -40)).toEqual([PointsReach.MoreTo, 'reward-beard', 160]);
  });

  it('names nothing when every reward is in hand, or none is offered', () => {
    expect(reach([CUT, BEARD, PRODUCT], 358)).toEqual([
      PointsReach.None,
      null,
      0,
    ]);
    expect(reach([], 358, [])).toEqual([PointsReach.None, null, 0]);
  });

  it('knows a held reward by its coupon, never a name — so it holds in every language (OR-15, DEP-F11)', () => {
    // The card's language plays no part: the English card, which matched
    // `name.en` against coupon names and so excluded nothing, now excludes.
    expect(reach([CUT], 358)).toEqual([
      PointsReach.EnoughFor,
      'reward-beard',
      0,
    ]);
    // Two rewards with one name are two rewards: holding one coupon holds
    // only the reward that mints it.
    const twins = [
      reward('reward-a', 300, 1, { name: { bg: 'Подарък', en: 'Gift' } }),
      reward('reward-b', 200, 2, { name: { bg: 'Подарък', en: 'Gift' } }),
    ];
    expect(reach([CouponId.of('coupon-reward-a')], 358, twins)).toEqual([
      PointsReach.EnoughFor,
      'reward-b',
      0,
    ]);
  });

  it('never holds a reward that mints no coupon — a voucher or a perk', () => {
    const voucher = reward('reward-voucher', 300, 0, {
      ...RewardGrantRule.voucher(
        unwrapOk(PriceCents.of(2000)),
        Currency.EUR,
        90,
      ),
    });
    expect(
      reach([CouponId.of('coupon-reward-voucher')], 358, [voucher]),
    ).toEqual([PointsReach.EnoughFor, 'reward-voucher', 0]);
  });

  it('names only what the catalogue offers today: never a reward switched off or over', () => {
    const closed = [
      named('reward-off', 300, 0, 'Изключена', 'Off'),
      named('reward-over', 350, 0, 'Приключила', 'Over'),
      ...seed,
    ].map((item) =>
      item.id === RewardId.of('reward-off')
        ? { ...item, enabled: false }
        : item.id === RewardId.of('reward-over')
          ? { ...item, availableUntil: day('2026-09-27') }
          : item,
    );
    expect(reach([], 358, closed)).toEqual([
      PointsReach.EnoughFor,
      'reward-cut',
      0,
    ]);
  });
});

describe('RewardSystem.groupGrants (loyalty.presenter.ts `groupedGrants`)', () => {
  const TEN = unwrapOk(CouponValue.percentOff(10));
  const TWENTY = unwrapOk(CouponValue.percentOff(20));
  const grant = (
    grantId: string,
    couponId: string,
    expiresOn: string | null,
    value: CouponValue = TEN,
  ): GrantTicketRef => ({
    grantId: CouponGrantId.of(grantId),
    couponId: CouponId.of(couponId),
    value,
    expiresOn: expiresOn === null ? null : day(expiresOn),
  });
  const punch = grant('grant-dev-georgi-punch', 'coupon-cut', '2026-10-28');
  const beard = grant('grant-beard', 'coupon-beard', null);

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

  it('stacks the grants of one coupon at one value into one ticket, the soonest first inside it', () => {
    const later = grant('grant-cut-2', 'coupon-cut', '2026-12-01');
    const sooner = grant('grant-cut-1', 'coupon-cut', '2026-11-01');
    const tickets = RewardSystem.groupGrants([later, beard, sooner], []);
    expect(tickets.map((t) => t.grants.map((g) => g.grantId))).toEqual([
      ['grant-cut-1', 'grant-cut-2'],
      ['grant-beard'],
    ]);
    expect(RewardSystem.groupGrants([], [])).toEqual([]);
  });

  it('keeps two coupons apart, whatever their names — a grant carries no name (OR-15, DEP-F11)', () => {
    // Both coupons are called «Рожден ден» on the card; the key is the coupon.
    const ours = grant('grant-1', 'coupon-birthday', '2026-11-01');
    const theirs = grant('grant-2', 'coupon-birthday-vip', '2026-11-01');
    expect(
      RewardSystem.groupGrants([ours, theirs], []).map((t) =>
        t.grants.map((g) => g.grantId),
      ),
    ).toEqual([['grant-1'], ['grant-2']]);
  });

  it('keeps one coupon granted at two values as two tickets', () => {
    const ten = grant('grant-1', 'coupon-cut', '2026-11-01', TEN);
    const twenty = grant('grant-2', 'coupon-cut', '2026-11-02', TWENTY);
    const tenAgain = grant('grant-3', 'coupon-cut', '2026-11-03', TEN);
    expect(
      RewardSystem.groupGrants([ten, twenty, tenAgain], []).map((t) =>
        t.grants.map((g) => g.grantId),
      ),
    ).toEqual([['grant-1', 'grant-3'], ['grant-2']]);
  });

  it('breaks a tie of days by the grant’s id', () => {
    const a = grant('grant-a', 'coupon-x', '2026-11-01');
    const b = grant('grant-b', 'coupon-y', '2026-11-01');
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
        couponId: CouponId.of('k'),
        value: unwrapOk(CouponValue.percentOff(10)),
        expiresOn: day('2026-12-01'),
      },
      {
        grantId: CouponGrantId.of('g1'),
        couponId: CouponId.of('k'),
        value: unwrapOk(CouponValue.percentOff(10)),
        expiresOn: day('2026-11-01'),
      },
    ]);
    const held = deepFreeze([CouponId.of('coupon-reward-product')]);
    const run = () => [
      RewardSystem.bestAffordable(rewards, 358, TODAY),
      RewardSystem.nextAffordable(rewards, 358, TODAY),
      RewardSystem.offered(rewards, TODAY),
      RewardSystem.affordable(rewards[0] as RewardCatalogItem, 358, TODAY),
      RewardSystem.groupGrants(grants, []),
      RewardSystem.tiles(rewards, 358, TODAY),
      RewardSystem.pointsReach(rewards, 358, TODAY),
      RewardSystem.pointsReach(rewards, 50, TODAY),
      RewardSystem.pointsReachBeyondHeld(rewards, held, 358, TODAY),
      RewardSystem.pointsReachBeyondHeld(rewards, held, 50, TODAY),
    ];
    expect(run()).toEqual(run());
    expect(rewards.map((item) => item.id)).toEqual([
      'reward-product',
      'reward-beard',
    ]);
    expect(held).toEqual(['coupon-reward-product']);
  });
});
