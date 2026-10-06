import { describe, expect, it } from 'vitest';
import { LocalizedText } from '@creativo/domain/catalog';
import { BadgeCategory } from './badge-category';
import {
  BadgeSeries,
  BadgeSeriesProps,
  BadgeSubjectProps,
  MetricRefProps,
} from './badge-series';
import type { RewardCatalogItem, TierDefinition } from './catalog-entries';
import { LoyaltyCatalog } from './loyalty-catalog';
import type { BadgeProgress, TierState } from './projections';
import { Season } from './season';
import {
  bestAffordable,
  closestLevels,
  earnedLevelCount,
  familiesIn,
  familyCounts,
  isNewSince,
  levelNumeral,
  nextAffordable,
  recentLevelsByDay,
  redeemProblem,
  tierSteps,
} from './standing';

// ── A small catalogue in the seed's image (§4.6), on its today ──────────

const TODAY = '2026-09-28';

function must<T>(result: {
  isSuccess(): boolean;
  value?: T;
  error?: unknown;
}): T {
  if (!result.isSuccess()) throw new Error(JSON.stringify(result.error));
  return result.value as T;
}

const text = (bg: string) =>
  must<LocalizedText>(LocalizedText.create({ bg, en: bg }));

const CATEGORY_ORDER = {
  'cat-milestones': 1,
  'cat-mastery': 2,
  'cat-barbers': 3,
  'cat-rhythm': 4,
  'cat-special': 5,
} as const;

interface Family {
  id: string;
  home: keyof typeof CATEGORY_ORDER | { season: string };
  order: number;
  metric: MetricRefProps | null;
  targets: readonly (number | null)[];
  subject?: BadgeSubjectProps;
  retired?: boolean;
}

const visits = (where?: MetricRefProps['where']): MetricRefProps => ({
  metric: 'client.visits.completed',
  ...(where === undefined ? {} : { where }),
});

const FAMILIES: readonly Family[] = [
  {
    id: 'series-visits',
    home: 'cat-milestones',
    order: 1,
    metric: visits(),
    targets: [1, 5, 10, 25, 50],
  },
  {
    id: 'series-tenure',
    home: 'cat-milestones',
    order: 2,
    metric: { metric: 'client.tenure.days' },
    targets: [365, 730, 1095],
  },
  {
    id: 'series-self-service',
    home: 'cat-milestones',
    order: 3,
    metric: { metric: 'client.bookings.selfService' },
    targets: [1, 5, 10, 25],
  },
  {
    id: 'series-old-promo',
    home: 'cat-milestones',
    order: 4,
    metric: visits(),
    targets: [2],
    retired: true,
  },
  {
    id: 'series-svc-fade',
    home: 'cat-mastery',
    order: 7,
    metric: visits({ serviceId: 'svc-fade' }),
    targets: [3, 10, 25, 50],
    subject: { kind: 'service', serviceId: 'svc-fade' },
  },
  {
    id: 'series-svc-beard',
    home: 'cat-mastery',
    order: 8,
    metric: visits({ serviceId: 'svc-beard' }),
    targets: [3, 10, 25],
    subject: { kind: 'service', serviceId: 'svc-beard' },
  },
  {
    id: 'series-barber-ivan',
    home: 'cat-barbers',
    order: 15,
    metric: visits({ barberId: 'ivan' }),
    targets: [1, 5, 10, 25],
    subject: { kind: 'barber', barberId: 'ivan' },
  },
  {
    id: 'series-shop-center',
    home: 'cat-barbers',
    order: 18,
    metric: visits({ locationId: 'loc-center' }),
    targets: [1, 5, 10, 25],
    subject: { kind: 'location', locationId: 'loc-center' },
  },
  {
    id: 'series-rhythm',
    home: 'cat-rhythm',
    order: 22,
    metric: null,
    targets: [3, 6, 12, 18, 24],
  },
  {
    id: 'series-early-bird',
    home: 'cat-special',
    order: 27,
    metric: { metric: 'client.visits.earlyBird' },
    targets: [1, 5, 10, 25],
  },
  {
    id: 'series-welcome',
    home: 'cat-special',
    order: 25,
    metric: null,
    targets: [null],
  },
  {
    id: 'series-autumn-track',
    home: { season: 'season-autumn' },
    order: 32,
    metric: visits(),
    targets: [1, 2, 3, 4, 5],
  },
  {
    id: 'series-autumn-beard',
    home: { season: 'season-autumn' },
    order: 34,
    metric: visits({ serviceId: 'svc-beard' }),
    targets: [2],
  },
  {
    id: 'series-summer-track',
    home: { season: 'season-summer' },
    order: 39,
    metric: visits(),
    targets: [1, 2, 3, 4, 5],
  },
  {
    id: 'series-winter-track',
    home: { season: 'season-winter' },
    order: 43,
    metric: visits(),
    targets: [1, 2, 3],
  },
];

function family(f: Family): BadgeSeries {
  const props: BadgeSeriesProps = {
    id: f.id,
    categoryId: typeof f.home === 'string' ? f.home : null,
    seasonId: typeof f.home === 'string' ? null : f.home.season,
    title: { bg: f.id, en: f.id },
    requirement: { bg: f.id, en: f.id },
    emblem: 'visits',
    subject: f.subject ?? null,
    metric: f.metric,
    art: null,
    levels: f.targets.map((target, i) => ({
      level: i + 1,
      ruleId: `${f.id}-${i + 1}`,
      target,
      requirement: { bg: String(target), en: String(target) },
      awards: [],
    })),
    repeatable: false,
    order: f.order,
    retiredAt: f.retired ? new Date('2026-01-01T00:00:00.000Z') : null,
    version: 1,
  };
  return must<BadgeSeries>(BadgeSeries.create(props));
}

const season = (
  id: string,
  from: string,
  until: string,
  announcedAt: string,
  track: string,
  rest: readonly string[],
): Season =>
  must<Season>(
    Season.create({
      id,
      kind: 'season',
      title: { bg: id, en: id },
      emblem: 'autumn',
      window: { from, until },
      trackSeriesId: track,
      seriesIds: rest,
      announcedAt: new Date(announcedAt),
      version: 1,
    }),
  );

const tier = (id: string, rank: number, atLeast: number): TierDefinition => ({
  id,
  name: text(id),
  rank,
  benefits: [],
  version: 1,
  effectiveFrom: new Date('2025-03-01T07:00:00.000Z'),
  qualify: {
    metric: 'client.visits.completed',
    atLeast,
    window: { lastDays: 365 },
  },
});

const catalog = must<LoyaltyCatalog>(
  LoyaltyCatalog.create({
    categories: Object.entries(CATEGORY_ORDER).map(([id, order]) =>
      must<BadgeCategory>(
        BadgeCategory.create({
          id,
          kind: 'milestones',
          title: { bg: id, en: id },
          order,
        }),
      ),
    ),
    series: FAMILIES.map(family),
    seasons: [
      season(
        'season-summer',
        '2026-06-01',
        '2026-08-31',
        '2026-05-01T06:00:00.000Z',
        'series-summer-track',
        [],
      ),
      season(
        'season-autumn',
        '2026-09-01',
        '2026-11-30',
        '2026-08-01T06:00:00.000Z',
        'series-autumn-track',
        ['series-autumn-beard'],
      ),
      season(
        'season-winter',
        '2026-12-01',
        '2027-02-28',
        '2026-10-01T06:00:00.000Z',
        'series-winter-track',
        [],
      ),
    ],
    tiers: [
      tier('gold', 2, 12),
      tier('bronze', 0, 0),
      tier('platinum', 3, 20),
      tier('silver', 1, 6),
    ],
    rewards: [],
  }),
);

const at = (iso: string) => new Date(iso);

function progressOf(
  entries: Record<string, { value: number; earned?: Record<number, string> }>,
): ReadonlyMap<string, BadgeProgress> {
  return new Map(
    Object.entries(entries).map(([seriesId, p]) => [
      seriesId,
      {
        seriesId,
        value: p.value,
        earned: Object.entries(p.earned ?? {}).map(([level, earnedAt]) => ({
          level: Number(level),
          earnedAt: at(earnedAt),
          via: 'rule' as const,
          count: 1,
        })),
      },
    ]),
  );
}

const levelsUpTo = (n: number, iso = '2026-05-10T07:00:00.000Z') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, iso]));

/** Георги's shape: 24 visits, all fades with Иван at Център at 10:00. */
const georgi = progressOf({
  'series-visits': { value: 24, earned: levelsUpTo(3) },
  'series-tenure': { value: 570, earned: levelsUpTo(1) },
  'series-self-service': { value: 7, earned: levelsUpTo(2) },
  'series-svc-fade': { value: 24, earned: levelsUpTo(2) },
  'series-barber-ivan': { value: 24, earned: levelsUpTo(3) },
  'series-shop-center': { value: 24, earned: levelsUpTo(3) },
  'series-rhythm': { value: 24, earned: levelsUpTo(5) },
  'series-early-bird': { value: 24, earned: levelsUpTo(3) },
  'series-welcome': { value: 1, earned: levelsUpTo(1) },
  'series-autumn-track': {
    value: 2,
    earned: levelsUpTo(2, '2026-09-10T07:00:00.000Z'),
  },
  'series-summer-track': {
    value: 3,
    earned: levelsUpTo(3, '2026-08-10T07:00:00.000Z'),
  },
});

// ── levels and counts ───────────────────────────────────────────────────

describe('levelNumeral', () => {
  it.each([
    [1, 'I'],
    [2, 'II'],
    [3, 'III'],
    [4, 'IV'],
    [5, 'V'],
    [9, 'IX'],
    [10, 'X'],
    [14, 'XIV'],
  ])('draws %i as «%s»', (level, numeral) => {
    expect(levelNumeral(level)).toBe(numeral);
  });

  it.each([0, -1, 1.5, Number.NaN])('draws nothing for %s', (level) => {
    expect(levelNumeral(level)).toBe('');
  });
});

describe('earnedLevelCount', () => {
  it('counts every earned level once', () => {
    expect(earnedLevelCount(georgi)).toBe(
      3 + 1 + 2 + 2 + 3 + 3 + 5 + 3 + 1 + 2 + 3,
    );
    expect(earnedLevelCount(new Map())).toBe(0);
  });
});

describe('familiesIn and familyCounts, per scope', () => {
  const ids = (scope: Parameters<typeof familiesIn>[2], progress = georgi) =>
    familiesIn(catalog, progress, scope, TODAY).map((s) => s.id.value);

  it('a shelf: its families by order, a retired one only where started', () => {
    expect(ids({ kind: 'category', categoryId: 'cat-milestones' })).toEqual([
      'series-visits',
      'series-tenure',
      'series-self-service',
    ]);
    const started = progressOf({ 'series-old-promo': { value: 1 } });
    expect(
      ids({ kind: 'category', categoryId: 'cat-milestones' }, started),
    ).toContain('series-old-promo');
    expect(
      familyCounts(
        catalog,
        georgi,
        { kind: 'category', categoryId: 'cat-mastery' },
        TODAY,
      ),
    ).toEqual({ started: 1, earned: 1, total: 2 });
    // Started is not earned: the retired family holds progress, no level.
    expect(
      familyCounts(
        catalog,
        started,
        { kind: 'category', categoryId: 'cat-milestones' },
        TODAY,
      ),
    ).toMatchObject({ started: 1, earned: 0 });
  });

  it('a season: its own families, never the track', () => {
    expect(ids({ kind: 'season', seasonId: 'season-autumn' })).toEqual([
      'series-autumn-beard',
    ]);
    expect(
      familyCounts(
        catalog,
        georgi,
        { kind: 'season', seasonId: 'season-autumn' },
        TODAY,
      ),
    ).toEqual({ started: 0, earned: 0, total: 1 });
    expect(ids({ kind: 'season', seasonId: 'season-nope' })).toEqual([]);
  });

  it('the archive: every family of the windows that ended', () => {
    expect(ids({ kind: 'archive' })).toEqual(['series-summer-track']);
    expect(familyCounts(catalog, georgi, { kind: 'archive' }, TODAY)).toEqual({
      started: 1,
      earned: 1,
      total: 1,
    });
  });

  it('a day: the families with a level earned on that Sofia day', () => {
    const progress = progressOf({
      // 21:30 UTC on 3 September is 00:30 on the 4th in Sofia.
      'series-visits': { value: 24, earned: { 3: '2026-09-03T21:30:00.000Z' } },
      'series-svc-fade': {
        value: 24,
        earned: { 2: '2026-09-04T07:00:00.000Z' },
      },
      'series-barber-ivan': {
        value: 24,
        earned: { 3: '2026-09-03T07:00:00.000Z' },
      },
    });
    expect(ids({ kind: 'day', day: '2026-09-04' }, progress)).toEqual([
      'series-visits',
      'series-svc-fade',
    ]);
    expect(
      familyCounts(
        catalog,
        progress,
        { kind: 'day', day: '2026-09-04' },
        TODAY,
      ),
    ).toEqual({ started: 2, earned: 2, total: 2 });
  });
});

// ── «Скоро» ─────────────────────────────────────────────────────────────

describe('closestLevels — the diversity rule', () => {
  const rail = (progress: ReadonlyMap<string, BadgeProgress>, limit = 5) =>
    closestLevels(catalog, progress, TODAY, limit).map(
      (c) => `${c.seriesId} ${c.level} ${c.value}/${c.target}`,
    );

  it('keeps the service when one visit would complete five families, and one family per shelf', () => {
    expect(rail(georgi)).toEqual([
      'series-svc-fade 3 24/25',
      'series-self-service 3 7/10',
      'series-autumn-track 3 2/3',
    ]);
  });

  it('fills no further than the limit', () => {
    expect(rail(georgi, 1)).toEqual(['series-svc-fade 3 24/25']);
    expect(rail(georgi, 0)).toEqual([]);
  });

  it('never proposes tenure, a complete family, a retired one or a window that is not open', () => {
    const seen = closestLevels(catalog, georgi, TODAY, 50).map(
      (c) => c.seriesId,
    );
    expect(seen).not.toContain('series-tenure');
    expect(seen).not.toContain('series-rhythm');
    expect(seen).not.toContain('series-welcome');
    expect(seen).not.toContain('series-old-promo');
    expect(seen).not.toContain('series-summer-track');
    expect(seen).not.toContain('series-winter-track');
  });

  // Мартин's shape: a family nobody's visits move yet must not evict a started one.
  it('lets no unstarted family yield a started one', () => {
    const martin = progressOf({
      'series-barber-ivan': { value: 7, earned: levelsUpTo(2) },
    });
    // «С Иван III» is 7/10 and an unstarted «Брада I» is 0/3: both three
    // visits away, only the started one is moved by the client's visits.
    expect(rail(martin)).toContain('series-barber-ivan 3 7/10');
  });

  it('keeps a season’s family beside the service it shares a visit with', () => {
    const progress = progressOf({
      'series-svc-fade': { value: 24, earned: levelsUpTo(2) },
      'series-autumn-beard': { value: 1 },
    });
    const seen = rail(progress);
    expect(seen).toContain('series-svc-fade 3 24/25');
    expect(seen).toContain('series-autumn-beard 1 1/2');
  });

  it('prefers the barber over the shop, and the shop over no subject, on the same visit', () => {
    const noService = progressOf({
      'series-visits': { value: 24, earned: levelsUpTo(3) },
      'series-barber-ivan': { value: 24, earned: levelsUpTo(3) },
      'series-shop-center': { value: 24, earned: levelsUpTo(3) },
    });
    expect(rail(noService)[0]).toBe('series-barber-ivan 4 24/25');
    const shopOnly = progressOf({
      'series-visits': { value: 24, earned: levelsUpTo(3) },
      'series-shop-center': { value: 24, earned: levelsUpTo(3) },
    });
    expect(rail(shopOnly)[0]).toBe('series-shop-center 4 24/25');
  });

  it('ranks equal ratios by the nearer finish, then the shelf, one family per shelf', () => {
    const progress = progressOf({
      'series-self-service': { value: 5, earned: levelsUpTo(2) }, // 5/10
      'series-autumn-beard': { value: 1 }, // 1/2
    });
    expect(rail(progress)).toEqual([
      'series-autumn-beard 1 1/2',
      'series-self-service 3 5/10',
      // Nothing else started: one visit away first, shelf by shelf.
      'series-barber-ivan 1 0/1',
      'series-early-bird 1 0/1',
      'series-svc-fade 1 0/3',
    ]);
  });
});

// ── «Последни» and «Ново» ───────────────────────────────────────────────

describe('recentLevelsByDay', () => {
  const progress = progressOf({
    'series-visits': { value: 24, earned: { 3: '2026-09-03T21:30:00.000Z' } },
    'series-svc-fade': { value: 24, earned: { 2: '2026-09-04T07:00:00.000Z' } },
    'series-barber-ivan': {
      value: 24,
      earned: { 3: '2026-08-10T07:00:00.000Z' },
    },
  });

  it('groups by the Sofia day, newest day first, newest level first', () => {
    const days = recentLevelsByDay(progress, 5);
    expect(days.map((d) => d.day)).toEqual(['2026-09-04', '2026-08-10']);
    expect(days[0]?.levels.map((l) => `${l.seriesId} ${l.level}`)).toEqual([
      'series-svc-fade 2',
      'series-visits 3',
    ]);
  });

  it('stops at the limit, counting days', () => {
    expect(recentLevelsByDay(progress, 1).map((d) => d.day)).toEqual([
      '2026-09-04',
    ]);
    expect(recentLevelsByDay(new Map(), 3)).toEqual([]);
  });
});

describe('isNewSince', () => {
  const earned = at('2026-09-04T07:00:00.000Z');

  it('is new when earned after the previous visit began', () => {
    expect(isNewSince(earned, at('2026-09-01T07:00:00.000Z').getTime())).toBe(
      true,
    );
    expect(isNewSince(earned, at('2026-09-04T07:00:00.000Z').getTime())).toBe(
      false,
    );
    expect(isNewSince(earned, at('2026-09-10T07:00:00.000Z').getTime())).toBe(
      false,
    );
  });

  it('is new before any first visit', () => {
    expect(isNewSince(earned, null)).toBe(true);
  });
});

// ── rewards and tiers ───────────────────────────────────────────────────

const reward = (
  id: string,
  cost: number,
  order: number,
  over: Partial<RewardCatalogItem> = {},
): RewardCatalogItem => ({
  id,
  name: text(id),
  cost,
  enabled: true,
  order,
  grants: { kind: 'coupon', couponId: `coupon-${id}` },
  available: { from: null, until: null },
  limits: { perClient: null, total: null },
  redeemedCount: 0,
  ...over,
});

describe('redeemProblem', () => {
  const beard = reward('reward-beard', 120, 1, {
    limits: { perClient: { count: 1, windowDays: 30 }, total: null },
  });
  const ctx = { balance: 358, today: TODAY, paused: false, recent: [] };

  it('lets an affordable, open, stocked reward through', () => {
    expect(redeemProblem(beard, ctx)).toBeNull();
  });

  it.each<[string, RewardCatalogItem, Partial<typeof ctx>, string]>([
    ['switched off', { ...beard, enabled: false }, {}, 'disabled'],
    [
      'not open yet',
      { ...beard, available: { from: '2026-10-01', until: null } },
      {},
      'notYetAvailable',
    ],
    [
      'over',
      { ...beard, available: { from: null, until: '2026-09-27' } },
      {},
      'ended',
    ],
    [
      'sold out',
      { ...beard, limits: { perClient: null, total: 5 }, redeemedCount: 5 },
      {},
      'soldOut',
    ],
    ['held by a pause', beard, { paused: true }, 'paused'],
    ['beyond the balance', beard, { balance: 119 }, 'insufficientPoints'],
    ['beyond an owed balance', beard, { balance: -40 }, 'insufficientPoints'],
  ])('refuses a reward %s', (_case, item, over, problem) => {
    expect(redeemProblem(item, { ...ctx, ...over })).toBe(problem);
  });

  it('counts the per-client limit inside its window only', () => {
    const recent = (on: string) => [{ rewardId: 'reward-beard', on }];
    expect(redeemProblem(beard, { ...ctx, recent: recent('2026-09-01') })).toBe(
      'perClientLimit',
    );
    expect(
      redeemProblem(beard, { ...ctx, recent: recent('2026-08-29') }),
    ).toBeNull();
    expect(
      redeemProblem(beard, {
        ...ctx,
        recent: [{ rewardId: 'reward-cut', on: '2026-09-20' }],
      }),
    ).toBeNull();
  });
});

describe('bestAffordable and nextAffordable', () => {
  const rewards = [
    reward('reward-product', 400, 3),
    reward('reward-beard', 120, 1),
    reward('reward-cut', 250, 2),
    reward('reward-off', 100, 4, { enabled: false }),
  ];
  const best = (balance: number) =>
    bestAffordable(rewards, balance, TODAY)?.id ?? null;
  const next = (balance: number) =>
    nextAffordable(rewards, balance, TODAY)?.id ?? null;

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
});

describe('tierSteps', () => {
  const state: TierState = {
    current: 'gold',
    definitionVersion: 1,
    since: at('2026-05-10T07:00:00.000Z'),
    qualifying: 14,
    next: 'platinum',
    remaining: 6,
    override: null,
  };

  it('draws every tier by rank, with the account’s own figures', () => {
    const track = tierSteps(state, catalog.tiers);
    expect(track.steps.map((s) => `${s.tierId}@${s.atLeast}`)).toEqual([
      'bronze@0',
      'silver@6',
      'gold@12',
      'platinum@20',
    ]);
    expect(track.steps[2]?.name.get('bg')).toBe('gold');
    expect(track).toMatchObject({
      value: 14,
      currentTierId: 'gold',
      nextTierId: 'platinum',
      remaining: 6,
    });
  });

  it('sorts tiers handed over in any order', () => {
    const shuffled = [...catalog.tiers].reverse();
    expect(tierSteps(state, shuffled).steps[0]?.tierId).toBe('bronze');
  });

  it('honours an override for the current step', () => {
    const granted = tierSteps(
      {
        ...state,
        override: {
          tierId: 'platinum',
          until: '2026-12-31',
          source: { kind: 'adjustment', adjustmentId: 'adj-1' },
        },
      },
      catalog.tiers,
    );
    expect(granted.currentTierId).toBe('platinum');
  });
});
