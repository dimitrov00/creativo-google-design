import { describe, expect, it } from 'vitest';
import { EarnedVia } from '../components/badge-level.data';
import {
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubjectSlot,
  Metric,
  MetricRef,
  SeasonKind,
} from '../components/gamification.data';
import {
  FamilyScopeFilter,
  type FamilyScopeFilter as Scope,
} from '../components/standing.data';
import type { BadgeCategory } from '../entities/badge-category.entity';
import type { BadgeProgress } from '../entities/badge-progress.entity';
import type { BadgeSeries } from '../entities/badge-series.entity';
import type { Season } from '../entities/season.entity';
import type { TierDefinition } from '../entities/tier-definition.entity';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  BarberId,
  LocationId,
  SeasonId,
  ServiceId,
  TierId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { FIXTURE_TIME_ZONE, deepFreeze, localDate, utcMs } from '../testing';
import { ZonedTimeSystem } from './zoned-time.system';
import { LoyaltyCatalogSystem } from './loyalty-catalog.system';
import { StandingSystem } from './standing.system';

/*
 * The cases of libs/domain/engagement/src/lib/loyalty/standing.spec.ts,
 * COPIED (the legacy spec keeps running against `standing.ts`'s shim) and
 * re-targeted: the catalogue is the flat `ValidLoyaltyCatalog` of entities,
 * a client's progress the array of `BadgeProgress` (id = the family), each
 * earned level stamped with its instant AND its Sofia day (T5, derived once
 * by the boundary here), so a scope or a day's grouping reads no zone.
 * Not here: `levelNumeral` (a template pipe now, §2.8 — the legacy cases
 * stay with it), `redeemProblem`/`bestAffordable`/`nextAffordable`
 * (reward.system.spec.ts) and `tierSteps` (tier.system.spec.ts).
 */

// ── A small catalogue in the seed's image (§4.6), on its today ──────────

const TODAY = localDate('2026-09-28');

const text = (bg: string) => ({ bg, en: bg });

const CATEGORY_ORDER = {
  'cat-milestones': 1,
  'cat-mastery': 2,
  'cat-barbers': 3,
  'cat-rhythm': 4,
  'cat-special': 5,
} as const;

type Where = {
  readonly serviceId?: string;
  readonly barberId?: string;
  readonly locationId?: string;
};

interface Family {
  id: string;
  home: keyof typeof CATEGORY_ORDER | { season: string };
  order: number;
  metric: MetricRef;
  targets: readonly (number | null)[];
  subject?: BadgeSubjectSlot;
  retired?: boolean;
}

const visits = (where: Where = {}): MetricRef => ({
  ...MetricRef.of(Metric.VisitsCompleted),
  metricScopeServiceId:
    where.serviceId === undefined ? null : ServiceId.of(where.serviceId),
  metricScopeBarberId:
    where.barberId === undefined ? null : BarberId.of(where.barberId),
  metricScopeLocationId:
    where.locationId === undefined ? null : LocationId.of(where.locationId),
});

const metricOf = (metric: Metric): MetricRef => MetricRef.of(metric);

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
    metric: metricOf(Metric.TenureDays),
    targets: [365, 730, 1095],
  },
  {
    id: 'series-self-service',
    home: 'cat-milestones',
    order: 3,
    metric: metricOf(Metric.BookingsSelfService),
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
    subject: BadgeSubjectSlot.service(ServiceId.of('svc-fade')),
  },
  {
    id: 'series-svc-beard',
    home: 'cat-mastery',
    order: 8,
    metric: visits({ serviceId: 'svc-beard' }),
    targets: [3, 10, 25],
    subject: BadgeSubjectSlot.service(ServiceId.of('svc-beard')),
  },
  {
    id: 'series-barber-ivan',
    home: 'cat-barbers',
    order: 15,
    metric: visits({ barberId: 'ivan' }),
    targets: [1, 5, 10, 25],
    subject: BadgeSubjectSlot.barber(BarberId.of('ivan')),
  },
  {
    id: 'series-shop-center',
    home: 'cat-barbers',
    order: 18,
    metric: visits({ locationId: 'loc-center' }),
    targets: [1, 5, 10, 25],
    subject: BadgeSubjectSlot.location(LocationId.of('loc-center')),
  },
  {
    id: 'series-rhythm',
    home: 'cat-rhythm',
    order: 22,
    metric: MetricRef.none(),
    targets: [3, 6, 12, 18, 24],
  },
  {
    id: 'series-early-bird',
    home: 'cat-special',
    order: 27,
    metric: metricOf(Metric.VisitsEarlyBird),
    targets: [1, 5, 10, 25],
  },
  {
    id: 'series-welcome',
    home: 'cat-special',
    order: 25,
    metric: MetricRef.none(),
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
  return {
    id: BadgeSeriesId.of(f.id),
    categoryId: typeof f.home === 'string' ? BadgeCategoryId.of(f.home) : null,
    seasonId: typeof f.home === 'string' ? null : SeasonId.of(f.home.season),
    title: text(f.id),
    requirement: text(f.id),
    emblem: BadgeEmblem.Visits,
    ...(f.subject ?? BadgeSubjectSlot.none()),
    ...f.metric,
    artPath: null,
    levels: f.targets.map((target, i) => ({
      level: i + 1,
      ruleId: AchievementRuleId.of(`${f.id}-${i + 1}`),
      target,
      requirement: text(String(target)),
      awards: [],
    })),
    repeatable: false,
    order: f.order,
    retiredAtUtcMs: f.retired ? utcMs('2026-01-01T00:00:00.000Z') : null,
    retiredLocalDate: f.retired ? localDate('2026-01-01') : null,
    version: 1,
  };
}

const season = (
  id: string,
  from: string,
  until: string,
  announcedAt: string,
  track: string,
  rest: readonly string[],
): Season => ({
  id: SeasonId.of(id),
  seasonKind: SeasonKind.Season,
  title: text(id),
  emblem: BadgeEmblem.Autumn,
  windowFrom: localDate(from),
  windowUntil: localDate(until),
  trackSeriesId: BadgeSeriesId.of(track),
  seriesIds: rest.map(BadgeSeriesId.of),
  ...stamp(announcedAt),
  version: 1,
});

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

const catalog = (() => {
  const result = LoyaltyCatalogSystem.validate({
    categories: Object.entries(CATEGORY_ORDER).map(
      ([id, order]): BadgeCategory => ({
        id: BadgeCategoryId.of(id),
        badgeCategoryKind: BadgeCategoryKind.Milestones,
        title: text(id),
        order,
      }),
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
    streaks: [],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

function at(iso: string): UtcEpochMs {
  return utcMs(iso);
}

/** A stamp as the boundary writes it: the instant, and its Sofia day (T5). */
function stamp(iso: string): {
  readonly announcedAtUtcMs: UtcEpochMs;
  readonly announcedLocalDate: ReturnType<typeof localDate>;
} {
  const announcedAtUtcMs = at(iso);
  return {
    announcedAtUtcMs,
    announcedLocalDate: ZonedTimeSystem.toLocal(
      announcedAtUtcMs,
      FIXTURE_TIME_ZONE,
    ).localDate,
  };
}

function progressOf(
  entries: Record<string, { value: number; earned?: Record<number, string> }>,
): readonly BadgeProgress[] {
  return Object.entries(entries).map(([seriesId, p]) => ({
    id: BadgeSeriesId.of(seriesId),
    value: p.value,
    earned: Object.entries(p.earned ?? {}).map(([level, earnedAt]) => {
      const earnedAtUtcMs = at(earnedAt);
      return {
        level: Number(level),
        earnedAtUtcMs,
        earnedLocalDate: ZonedTimeSystem.toLocal(
          earnedAtUtcMs,
          FIXTURE_TIME_ZONE,
        ).localDate,
        earnedVia: EarnedVia.Rule,
        count: 1,
      };
    }),
  }));
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

describe('earnedLevelCount', () => {
  it('counts every earned level once', () => {
    expect(StandingSystem.earnedLevelCount(georgi)).toBe(
      3 + 1 + 2 + 2 + 3 + 3 + 5 + 3 + 1 + 2 + 3,
    );
    expect(StandingSystem.earnedLevelCount([])).toBe(0);
  });
});

describe('familiesIn and familyCounts, per scope', () => {
  const ids = (scope: Scope, progress = georgi) =>
    StandingSystem.familiesIn(catalog, progress, scope, TODAY).map((s) => s.id);
  const familyCounts = (progress: readonly BadgeProgress[], scope: Scope) =>
    StandingSystem.familyCounts(catalog, progress, scope, TODAY);

  it('a shelf: its families by order, a retired one only where started', () => {
    expect(
      ids(FamilyScopeFilter.category(BadgeCategoryId.of('cat-milestones'))),
    ).toEqual(['series-visits', 'series-tenure', 'series-self-service']);
    const started = progressOf({ 'series-old-promo': { value: 1 } });
    expect(
      ids(
        FamilyScopeFilter.category(BadgeCategoryId.of('cat-milestones')),
        started,
      ),
    ).toContain('series-old-promo');
    expect(
      familyCounts(
        georgi,
        FamilyScopeFilter.category(BadgeCategoryId.of('cat-mastery')),
      ),
    ).toEqual({ started: 1, earned: 1, total: 2 });
    // Started is not earned: the retired family holds progress, no level.
    expect(
      familyCounts(
        started,
        FamilyScopeFilter.category(BadgeCategoryId.of('cat-milestones')),
      ),
    ).toMatchObject({ started: 1, earned: 0 });
  });

  it('a season: its own families, never the track', () => {
    expect(ids(FamilyScopeFilter.season(SeasonId.of('season-autumn')))).toEqual(
      ['series-autumn-beard'],
    );
    expect(
      familyCounts(
        georgi,
        FamilyScopeFilter.season(SeasonId.of('season-autumn')),
      ),
    ).toEqual({ started: 0, earned: 0, total: 1 });
    expect(ids(FamilyScopeFilter.season(SeasonId.of('season-nope')))).toEqual(
      [],
    );
  });

  it('the archive: every family of the windows that ended', () => {
    expect(ids(FamilyScopeFilter.archive())).toEqual(['series-summer-track']);
    expect(familyCounts(georgi, FamilyScopeFilter.archive())).toEqual({
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
    expect(
      ids(FamilyScopeFilter.day(localDate('2026-09-04')), progress),
    ).toEqual(['series-visits', 'series-svc-fade']);
    expect(
      familyCounts(progress, FamilyScopeFilter.day(localDate('2026-09-04'))),
    ).toEqual({ started: 2, earned: 2, total: 2 });
  });
});

// ── «Скоро» ─────────────────────────────────────────────────────────────

describe('closestLevels — the diversity rule', () => {
  const rail = (progress: readonly BadgeProgress[], limit = 5) =>
    StandingSystem.closestLevels(catalog, progress, TODAY, limit).map(
      (c) => `${c.badgeSeriesId} ${c.level} ${c.value}/${c.target}`,
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
    const seen = StandingSystem.closestLevels(catalog, georgi, TODAY, 50).map(
      (c) => c.badgeSeriesId,
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
    const days = StandingSystem.recentLevelsByDay(progress, 5);
    expect(days.map((d) => d.localDate)).toEqual(['2026-09-04', '2026-08-10']);
    expect(days[0]?.levels.map((l) => `${l.badgeSeriesId} ${l.level}`)).toEqual(
      ['series-svc-fade 2', 'series-visits 3'],
    );
  });

  it('stops at the limit, counting days', () => {
    expect(
      StandingSystem.recentLevelsByDay(progress, 1).map((d) => d.localDate),
    ).toEqual(['2026-09-04']);
    expect(StandingSystem.recentLevelsByDay([], 3)).toEqual([]);
  });

  it('reads no zone: a level is filed under its stored shop day, whatever its instant', () => {
    // Today's "a zone nobody knows places nothing": the day is the
    // boundary's, written beside the instant (T5).
    const filed: readonly BadgeProgress[] = [
      {
        id: BadgeSeriesId.of('series-visits'),
        value: 24,
        earned: [
          {
            level: 3,
            earnedAtUtcMs: at('2026-09-03T21:30:00.000Z'),
            earnedLocalDate: localDate('2026-09-04'),
            earnedVia: EarnedVia.Rule,
            count: 1,
          },
        ],
      },
    ];
    expect(
      StandingSystem.recentLevelsByDay(filed, 3).map((d) => d.localDate),
    ).toEqual(['2026-09-04']);
  });
});

describe('isNewSince', () => {
  const earned = at('2026-09-04T07:00:00.000Z');

  it('is new when earned after the previous visit began', () => {
    expect(
      StandingSystem.isNewSince(earned, at('2026-09-01T07:00:00.000Z')),
    ).toBe(true);
    expect(
      StandingSystem.isNewSince(earned, at('2026-09-04T07:00:00.000Z')),
    ).toBe(false);
    expect(
      StandingSystem.isNewSince(earned, at('2026-09-10T07:00:00.000Z')),
    ).toBe(false);
  });

  it('is new before any first visit', () => {
    expect(StandingSystem.isNewSince(earned, null)).toBe(true);
  });
});

describe('StandingSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const frozenCatalog = deepFreeze(catalog);
    const progress = deepFreeze(georgi);
    const run = () => [
      StandingSystem.closestLevels(frozenCatalog, progress, TODAY, 5),
      StandingSystem.familiesIn(
        frozenCatalog,
        progress,
        FamilyScopeFilter.archive(),
        TODAY,
      ),
      StandingSystem.recentLevelsByDay(progress, 5),
      StandingSystem.earnedLevelCount(progress),
    ];
    expect(run()).toEqual(run());
  });
});
