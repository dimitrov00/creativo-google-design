import { describe, expect, it } from 'vitest';
import {
  EarnedVia,
  HeadRole,
  MedalCue,
  MedalState,
  ScopeSection,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubjectSlot,
  Metric,
  MetricRef,
  SeasonKind,
  FamilyScopeFilter,
  type FamilyScopeFilter as Scope,
} from '@core/components';
import type {
  BadgeCategory,
  BadgeProgress,
  BadgeSeries,
  LoyaltyCatalogParts,
  Season,
  TierDefinition,
} from '@core/entities';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  BarberId,
  LocationId,
  SeasonId,
  ServiceCategoryId,
  ServiceId,
  TierId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
  loyaltyCatalogFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { BadgeSystem } from './badge.system';
import { ZonedTimeSystem } from './zoned-time.system';
import { LoyaltyCatalogSystem } from './loyalty-catalog.system';
import { StandingSystem } from './standing.system';

/*
 * The cases of the legacy engagement `standing.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED while it
 * still ran against `standing.ts`'s shim, and re-targeted: the catalogue is the
 * flat `ValidLoyaltyCatalog` of entities, a client's progress the array of
 * `BadgeProgress` (id = the family), each earned level stamped with its instant
 * AND its Sofia day (T5, derived once by the boundary here), so a scope or a
 * day's grouping reads no zone. Not here: `levelNumeral` (a template pipe now,
 * §2.8 — its legacy cases live in
 * `libs/features/staff/client-card/src/lib/client-card.format.spec.ts`, R5),
 * `redeemProblem`/`bestAffordable`/`nextAffordable` (reward.system.spec.ts) and
 * `tierSteps` (tier.system.spec.ts).
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

// ── The medals page and the glance strip (Law 10.2, the decision pass) ──
//
// The cases the presenters pinned (achievements, medals, medal-detail,
// client-card and glance specs), re-stated as values and tags over the same
// data: the published catalogue and Георги's and Мартин's books of
// `@core/testing`, on FIXTURE_TODAY (28.09.2026 — the autumn season and the
// beard week run, the summer has ended).

const FIXTURE_CATALOG = unwrapOk(
  LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
);
const GEORGI = loyaltyAccountFixtures.georgi.badgeProgress;
const MARTIN = loyaltyAccountFixtures.martin.badgeProgress;
/** Георги's previous worked visit: Thursday 3 September, 10:00 in Sofia. */
const GEORGI_PREVIOUS = utcMs('2026-09-03T07:00:00.000Z');

const seriesId = (id: string) => BadgeSeriesId.of(id);
const ids = (...raw: readonly string[]) => new Set(raw.map(seriesId));
const NOTHING = ids();
/** What Георги's next fade (Иван, Център, 10:00) completes: every family one short on a count it moves. */
const GEORGI_OPEN = ids(
  'series-visits',
  'series-svc-fade',
  'series-barber-ivan',
  'series-shop-center',
  'series-early-bird',
  'series-2026-autumn-track',
);
/** What Мартин's birthday cut completes: the yearly act, and the autumn track's first level. */
const MARTIN_BIRTHDAY = ids('series-birthday', 'series-2026-autumn-track');
const AUTUMN_TRACK = seriesId('series-2026-autumn-track');

function fixtureCatalogWith(
  edit: (parts: LoyaltyCatalogParts) => LoyaltyCatalogParts,
) {
  return unwrapOk(LoyaltyCatalogSystem.validate(edit(loyaltyCatalogFixture())));
}

function fixtureFamily(id: string): BadgeSeries {
  const found = LoyaltyCatalogSystem.series(FIXTURE_CATALOG, seriesId(id));
  if (found === null) throw new Error(`no family ${id}`);
  return found;
}

function shelf(id: string): readonly BadgeSeries[] {
  return LoyaltyCatalogSystem.seriesIn(FIXTURE_CATALOG, BadgeCategoryId.of(id));
}

const without = (
  progress: readonly BadgeProgress[],
  ...dropped: readonly string[]
) => progress.filter((p) => !dropped.includes(p.id));

const only = (progress: readonly BadgeProgress[], ...kept: readonly string[]) =>
  progress.filter((p) => kept.includes(p.id));

/** The catalogue with its rhythm's rule in force switched off. */
const RHYTHM_OFF = fixtureCatalogWith((parts) => ({
  ...parts,
  streaks: parts.streaks.map((head) => ({
    ...head,
    rules: head.rules.map((rule) =>
      rule.headRole === HeadRole.Current ? { ...rule, enabled: false } : rule,
    ),
  })),
}));

describe('isFamilyNew («ново» on a family)', () => {
  const standingOf = (id: string, progress = GEORGI) =>
    BadgeSystem.standing(
      fixtureFamily(id),
      progress.find((p) => p.id === id) ?? null,
    );
  const latestOf = (id: string, progress = GEORGI) =>
    BadgeSystem.latestEarned(progress.find((p) => p.id === id) ?? null);

  it('is an earned family whose latest level came since the previous visit', () => {
    // «В ритъм» V on 28.09, after the visit of 3.09.
    expect(
      StandingSystem.isFamilyNew(
        standingOf('series-rhythm'),
        latestOf('series-rhythm'),
        GEORGI_PREVIOUS,
      ),
    ).toBe(true);
    // «Фейд» II on 22.09.2025: long before it.
    expect(
      StandingSystem.isFamilyNew(
        standingOf('series-svc-fade'),
        latestOf('series-svc-fade'),
        GEORGI_PREVIOUS,
      ),
    ).toBe(false);
  });

  it('is every earned family before a first visit', () => {
    expect(
      StandingSystem.isFamilyNew(
        standingOf('series-svc-fade'),
        latestOf('series-svc-fade'),
        null,
      ),
    ).toBe(true);
  });

  it('is never a family without a level, however recent its progress', () => {
    // «Съботен» is under way at 2/3, with no level won.
    expect(
      StandingSystem.isFamilyNew(
        standingOf('series-weekend'),
        latestOf('series-weekend'),
        null,
      ),
    ).toBe(false);
    expect(
      StandingSystem.isFamilyNew(
        { medalState: MedalState.Earned },
        null,
        GEORGI_PREVIOUS,
      ),
    ).toBe(false);
  });
});

describe('shelfOrdered', () => {
  it('puts earned families first (highest level first), then the closest in progress, then the rest in catalogue order', () => {
    expect(
      StandingSystem.shelfOrdered(shelf('cat-barbers'), GEORGI).map(
        (s) => s.id,
      ),
    ).toEqual([
      // Earned at III, a tie kept in the shelf's order.
      'series-barber-ivan',
      'series-shop-center',
      // In progress at 1/2 each: a tie kept in the shelf's order.
      'series-all-barbers',
      'series-both-shops',
      // Not started: the shelf's order.
      'series-barber-niko',
      'series-barber-stefan',
      'series-shop-mladost',
    ]);
  });

  it('orders a shelf earned, then in progress, then not started — a complete single act among the earned', () => {
    expect(
      StandingSystem.shelfOrdered(shelf('cat-special'), GEORGI).map(
        (s) => s.id,
      ),
    ).toEqual([
      'series-early-bird',
      'series-on-time',
      'series-welcome',
      'series-weekend',
      'series-birthday',
      'series-profile',
      'series-party',
    ]);
  });

  it('keeps the order it was handed where nothing is started', () => {
    const families = [...shelf('cat-milestones')].reverse();
    expect(StandingSystem.shelfOrdered(families, [])).toEqual(families);
    expect(StandingSystem.shelfOrdered([], GEORGI)).toEqual([]);
  });
});

describe('soonIds («Скоро») and almostEarned («Почти спечелени»)', () => {
  const almost = (
    progress: readonly BadgeProgress[],
    completing: ReadonlySet<BadgeSeriesId>,
    options: { rhythmLive?: boolean; catalog?: typeof FIXTURE_CATALOG } = {},
  ) =>
    StandingSystem.almostEarned(
      options.catalog ?? FIXTURE_CATALOG,
      progress,
      FIXTURE_TODAY,
      {
        completing,
        excludeSeriesId: AUTUMN_TRACK,
        rhythmLive: options.rhythmLive ?? true,
        limit: 3,
      },
    );

  it('«Скоро» is the closest under the diversity rule where the visit completes nothing', () => {
    expect(
      StandingSystem.soonIds(
        FIXTURE_CATALOG,
        GEORGI,
        FIXTURE_TODAY,
        NOTHING,
        3,
      ),
    ).toEqual(['series-svc-fade', 'series-self-service', 'series-weekend']);
  });

  it('«Скоро» leads with the single act the visit completes, the closest after it, at most the limit', () => {
    expect(
      StandingSystem.soonIds(
        FIXTURE_CATALOG,
        MARTIN,
        FIXTURE_TODAY,
        MARTIN_BIRTHDAY,
        3,
      ),
    ).toEqual([
      'series-birthday',
      'series-twelve-months',
      'series-barber-ivan',
    ]);
    // A counted family the visit completes is no act: it keeps its rank.
    expect(
      StandingSystem.soonIds(
        FIXTURE_CATALOG,
        GEORGI,
        FIXTURE_TODAY,
        GEORGI_OPEN,
        3,
      ),
    ).toEqual(['series-svc-fade', 'series-self-service', 'series-weekend']);
    expect(
      StandingSystem.soonIds(
        FIXTURE_CATALOG,
        MARTIN,
        FIXTURE_TODAY,
        MARTIN_BIRTHDAY,
        0,
      ),
    ).toEqual([]);
  });

  it('«Почти» is one row of three, the nearest of each shelf, the running season’s track left to its card', () => {
    expect(almost(GEORGI, NOTHING)).toEqual([
      'series-svc-fade',
      'series-self-service',
      'series-weekend',
    ]);
    // The track is the nearest of all, one visit from III: still not here.
    expect(almost(GEORGI, GEORGI_OPEN)).not.toContain(AUTUMN_TRACK);
  });

  it('«Почти» leads with what this visit completes', () => {
    expect(almost(GEORGI, GEORGI_OPEN)[0]).toBe('series-svc-fade');
    // A single act the domain never ranks: a birthday visit.
    expect(almost(MARTIN, MARTIN_BIRTHDAY)).toEqual([
      'series-birthday',
      'series-twelve-months',
      'series-barber-ivan',
    ]);
  });

  it('«Почти» puts a level this visit completes before a nearer one it does not move', () => {
    const near = [
      ...without(GEORGI, 'series-self-service'),
      { ...must(GEORGI, 'series-self-service'), value: 9 },
    ];
    expect(almost(near, GEORGI_OPEN).slice(0, 2)).toEqual([
      'series-svc-fade',
      'series-self-service',
    ]);
  });

  it('«Почти» is empty when nothing is under way, but offers what the visit completes, begun or not', () => {
    expect(almost([], NOTHING)).toEqual([]);
    // A first fade with Иван at 10:00 lands three first levels, one per shelf.
    expect(almost([], GEORGI_OPEN)).toEqual([
      'series-visits',
      'series-barber-ivan',
      'series-early-bird',
    ]);
    // Every ladder climbed: nothing is left to be near.
    const done = fixtureCatalogWith((parts) => ({
      ...parts,
      series: parts.series.filter(
        (family) =>
          family.id === 'series-rhythm' || family.id === 'series-welcome',
      ),
      seasons: [],
    }));
    expect(almost(GEORGI, NOTHING, { catalog: done })).toEqual([]);
  });

  it('«Почти» offers fewer than three where fewer are under way', () => {
    expect(
      almost(only(GEORGI, 'series-weekend', 'series-svc-beard'), NOTHING),
    ).toEqual(['series-weekend', 'series-svc-beard']);
  });

  it('«Почти» never offers an earned family at value nought: under way is a count that moved', () => {
    // «Цяла година» alone on its shelf, I won and its windowed count back
    // at 0: the domain still ranks it (0/8 to II), «almost» does not.
    const alone = fixtureCatalogWith((parts) => ({
      ...parts,
      series: parts.series.filter(
        (family) => family.id === 'series-twelve-months',
      ),
      seasons: [],
    }));
    const progress = (value: number): BadgeProgress[] => [
      { ...must(MARTIN, 'series-twelve-months'), value },
    ];
    expect(
      BadgeSystem.standing(
        fixtureFamily('series-twelve-months'),
        must(progress(0), 'series-twelve-months'),
      ).medalState,
    ).toBe(MedalState.Earned);
    expect(
      StandingSystem.closestLevels(alone, progress(0), FIXTURE_TODAY, 3).map(
        (c) => c.badgeSeriesId,
      ),
    ).toEqual(['series-twelve-months']);
    expect(almost(progress(0), NOTHING, { catalog: alone })).toEqual([]);
    expect(almost(progress(1), NOTHING, { catalog: alone })).toEqual([
      'series-twelve-months',
    ]);
  });

  it('«Почти» offers no family of the rhythm’s shelf while the shop runs no rhythm', () => {
    expect(almost(MARTIN, NOTHING)).toContain('series-twelve-months');
    expect(almost(MARTIN, NOTHING, { rhythmLive: false })).not.toContain(
      'series-twelve-months',
    );
  });
});

describe('recentFreshLevelsByDay («Последни»)', () => {
  it('keeps a day’s every level for its stack, and only the fresh ones for its face', () => {
    // Two families on 4.09; «Фейд» moved again on 10.09 — a newer day.
    const progress = progressOf({
      'series-svc-fade': {
        value: 24,
        earned: {
          2: '2026-09-04T08:00:00.000Z',
          3: '2026-09-10T08:00:00.000Z',
        },
      },
      'series-visits': { value: 24, earned: { 3: '2026-09-04T07:00:00.000Z' } },
    });
    const days = StandingSystem.recentFreshLevelsByDay(progress);
    expect(
      days.map((day) => [
        day.localDate,
        day.levels.map((l) => `${l.badgeSeriesId} ${l.level}`),
        day.fresh.map((l) => `${l.badgeSeriesId} ${l.level}`),
      ]),
    ).toEqual([
      ['2026-09-10', ['series-svc-fade 3'], ['series-svc-fade 3']],
      [
        '2026-09-04',
        // A stack of two, «+1»…
        ['series-svc-fade 2', 'series-visits 3'],
        // …whose face can only be the family no newer day shows.
        ['series-visits 3'],
      ],
    ]);
  });

  it('drops a day whose every family a newer day already shows, and sets no day limit', () => {
    const days = StandingSystem.recentFreshLevelsByDay(GEORGI);
    // 3.09 held only the autumn track's I: its II on 28.09 shows it.
    expect(days.map((d) => d.localDate)).not.toContain('2026-09-03');
    expect(days[0]).toEqual({
      localDate: '2026-09-28',
      levels: StandingSystem.recentLevelsByDay(GEORGI, 1)[0]?.levels,
      fresh: StandingSystem.recentLevelsByDay(GEORGI, 1)[0]?.levels,
    });
    for (const day of days) expect(day.fresh.length).toBeGreaterThan(0);
    // Every family, once, on the newest day it moved.
    const faces = days.flatMap((d) => d.fresh.map((l) => l.badgeSeriesId));
    expect(new Set(faces).size).toBe(faces.length);
    expect(new Set(faces)).toEqual(
      new Set(GEORGI.filter((p) => p.earned.length > 0).map((p) => p.id)),
    );
    expect(StandingSystem.recentFreshLevelsByDay([])).toEqual([]);
  });
});

describe('earnedAmong, earnedOnly and scopeMedalState', () => {
  it('counts a group by its earned families, never by the started ones', () => {
    // Мартин's «Общи» on the mastery page: «Изследовател» under way.
    expect(
      StandingSystem.earnedAmong([fixtureFamily('series-explorer')], MARTIN),
    ).toBe(0);
    expect(StandingSystem.earnedAmong(shelf('cat-mastery'), GEORGI)).toBe(3);
    // A complete family is earned: the figure is the filled discs.
    expect(StandingSystem.earnedAmong(shelf('cat-rhythm'), GEORGI)).toBe(2);
    expect(StandingSystem.earnedAmong([], GEORGI)).toBe(0);
  });

  it('cuts a list to its earned families, in order — what an ended season keeps', () => {
    const summer = StandingSystem.familiesIn(
      FIXTURE_CATALOG,
      GEORGI,
      FamilyScopeFilter.season(SeasonId.of('season-2026-summer')),
      FIXTURE_TODAY,
    );
    expect(summer.map((s) => s.id)).toEqual([
      'series-2026-summer-each-month',
      'series-2026-summer-saturday',
      'series-2026-summer-before-leave',
    ]);
    expect(StandingSystem.earnedOnly(summer, GEORGI).map((s) => s.id)).toEqual([
      'series-2026-summer-each-month',
    ]);
    // familiesIn and familyCounts stay whole: «N от M» counts the window.
    expect(
      StandingSystem.familyCounts(
        FIXTURE_CATALOG,
        GEORGI,
        FamilyScopeFilter.season(SeasonId.of('season-2026-summer')),
        FIXTURE_TODAY,
      ).total,
    ).toBe(3);
  });

  it('lists a season’s families whole until its window ends, then only the earned (seasonListed)', () => {
    const summerId = SeasonId.of('season-2026-summer');
    const summer = StandingSystem.familiesIn(
      FIXTURE_CATALOG,
      GEORGI,
      FamilyScopeFilter.season(summerId),
      FIXTURE_TODAY,
    );
    const ids = (families: readonly { readonly id: string }[]) =>
      families.map((s) => s.id);
    const window = (from: string, until: string) => ({
      windowFrom: localDate(from),
      windowUntil: localDate(until),
    });
    // Ended (the summer, on the fixture's day): what was earned, in order.
    const ended = LoyaltyCatalogSystem.season(FIXTURE_CATALOG, summerId);
    expect(ended).not.toBeNull();
    expect(
      ids(
        StandingSystem.seasonListed(
          must2(ended),
          summer,
          GEORGI,
          FIXTURE_TODAY,
        ),
      ),
    ).toEqual(ids(StandingSystem.earnedOnly(summer, GEORGI)));
    expect(
      ids(
        StandingSystem.seasonListed(
          window('2026-09-01', '2026-09-27'),
          summer,
          GEORGI,
          FIXTURE_TODAY,
        ),
      ),
    ).toEqual(['series-2026-summer-each-month']);
    // Open — its last day included — and announced: the whole list, as is.
    for (const open of [
      window('2026-09-01', '2026-11-30'),
      window('2026-09-01', '2026-09-28'),
      window('2026-09-28', '2026-09-28'),
      window('2026-10-01', '2026-10-31'),
    ]) {
      expect(
        StandingSystem.seasonListed(open, summer, GEORGI, FIXTURE_TODAY),
      ).toBe(summer);
    }
    expect(
      StandingSystem.seasonListed(
        window('2026-06-01', '2026-08-31'),
        [],
        GEORGI,
        FIXTURE_TODAY,
      ),
    ).toEqual([]);
  });

  it('draws an archived window as one medal: earned, in progress, or not started', () => {
    // The beard week, one of its two families won.
    expect(
      StandingSystem.scopeMedalState({ started: 1, earned: 1, total: 2 }),
    ).toBe(MedalState.Earned);
    expect(
      StandingSystem.scopeMedalState({ started: 2, earned: 0, total: 2 }),
    ).toBe(MedalState.InProgress);
    expect(
      StandingSystem.scopeMedalState({ started: 0, earned: 0, total: 2 }),
    ).toBe(MedalState.NotStarted);
  });
});

describe('sectionsOf', () => {
  const CATEGORY = new Map([
    [ServiceId.of('svc-classic-cut'), ServiceCategoryId.of('hair')],
    [ServiceId.of('svc-fade'), ServiceCategoryId.of('hair')],
    [ServiceId.of('svc-beard'), ServiceCategoryId.of('beard')],
    [ServiceId.of('svc-scissor-trim'), ServiceCategoryId.of('hair')],
    [ServiceId.of('svc-modern-cut'), ServiceCategoryId.of('hair')],
    [ServiceId.of('svc-finish'), ServiceCategoryId.of('beard')],
    [ServiceId.of('svc-full-care'), ServiceCategoryId.of('care')],
    [ServiceId.of('svc-father-son'), ServiceCategoryId.of('hair')],
  ]);
  const sections = (
    kind: BadgeCategoryKind,
    families: readonly BadgeSeries[],
    categories = CATEGORY,
  ) =>
    StandingSystem.sectionsOf(kind, families, categories).map((section) => [
      section.scopeSection,
      section.key,
      section.families.map((s) => s.id),
    ]);

  it('sections mastery by the service’s own category, in the order they first appear, then «Общи»', () => {
    expect(sections(BadgeCategoryKind.Mastery, shelf('cat-mastery'))).toEqual([
      [
        ScopeSection.ServiceCategory,
        'hair',
        [
          'series-svc-classic-cut',
          'series-svc-fade',
          'series-svc-scissor-trim',
          'series-svc-modern-cut',
          'series-svc-father-son',
        ],
      ],
      [
        ScopeSection.ServiceCategory,
        'beard',
        ['series-svc-beard', 'series-svc-finish'],
      ],
      [ScopeSection.ServiceCategory, 'care', ['series-svc-full-care']],
      [ScopeSection.General, null, ['series-explorer']],
    ]);
  });

  it('files a service the host files under no category with «Общи»', () => {
    const fewer = new Map(
      [...CATEGORY].filter(([id]) => id !== 'svc-full-care'),
    );
    expect(
      sections(BadgeCategoryKind.Mastery, shelf('cat-mastery'), fewer).at(-1),
    ).toEqual([
      ScopeSection.General,
      null,
      ['series-svc-full-care', 'series-explorer'],
    ]);
    expect(sections(BadgeCategoryKind.Mastery, [])).toEqual([]);
  });

  it('sections barbers and shops apart, the rest «Общи»', () => {
    expect(sections(BadgeCategoryKind.Barbers, shelf('cat-barbers'))).toEqual([
      [
        ScopeSection.Barbers,
        null,
        ['series-barber-ivan', 'series-barber-niko', 'series-barber-stefan'],
      ],
      [ScopeSection.Shops, null, ['series-shop-center', 'series-shop-mladost']],
      [ScopeSection.General, null, ['series-all-barbers', 'series-both-shops']],
    ]);
    // A section with nothing in it is left out.
    expect(
      sections(BadgeCategoryKind.Barbers, [
        fixtureFamily('series-shop-center'),
      ]),
    ).toEqual([[ScopeSection.Shops, null, ['series-shop-center']]]);
  });

  it('draws any other shelf as one grid of all its families', () => {
    expect(sections(BadgeCategoryKind.Special, shelf('cat-special'))).toEqual([
      [ScopeSection.Whole, null, shelf('cat-special').map((s) => s.id)],
    ]);
    expect(sections(BadgeCategoryKind.Records, [])).toEqual([
      [ScopeSection.Whole, null, []],
    ]);
  });
});

describe('neighboursOf', () => {
  const neighbours = (id: string, catalog = FIXTURE_CATALOG) =>
    StandingSystem.neighboursOf(
      catalog,
      GEORGI,
      fixtureFamily(id),
      FIXTURE_TODAY,
    ).map((s) => s.id);

  it('is the family’s shelf in shelf order, itself left out, unlimited', () => {
    expect(neighbours('series-svc-fade')).toEqual([
      'series-svc-beard',
      'series-explorer',
      'series-svc-classic-cut',
      'series-svc-scissor-trim',
      'series-svc-modern-cut',
      'series-svc-finish',
      'series-svc-full-care',
      'series-svc-father-son',
    ]);
  });

  it('is a season’s family’s window WITH its track', () => {
    expect(neighbours('series-2026-autumn-early')).toEqual([
      'series-2026-autumn-track',
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
      'series-2026-autumn-referral',
    ]);
  });

  it('is only what was earned in a window that ended', () => {
    expect(neighbours('series-2026-summer-each-month')).toEqual([
      'series-2026-summer-track',
    ]);
  });

  it('leaves a withdrawn family out unless the client started it', () => {
    const retired = fixtureCatalogWith((parts) => ({
      ...parts,
      series: parts.series.map((family) =>
        family.id === 'series-2026-autumn-referral' ||
        family.id === 'series-2026-autumn-each-month'
          ? {
              ...family,
              retiredAtUtcMs: utcMs('2026-09-20T07:00:00.000Z'),
              retiredLocalDate: localDate('2026-09-20'),
            }
          : family,
      ),
    }));
    expect(neighbours('series-2026-autumn-early', retired)).toEqual([
      'series-2026-autumn-track',
      // Started at 1/3: kept.
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
  });

  it('is nothing where the family stands alone', () => {
    expect(
      StandingSystem.neighboursOf(
        FIXTURE_CATALOG,
        GEORGI,
        { ...fixtureFamily('series-svc-fade'), categoryId: null },
        FIXTURE_TODAY,
      ),
    ).toEqual([]);
    expect(
      StandingSystem.neighboursOf(
        FIXTURE_CATALOG,
        GEORGI,
        {
          ...fixtureFamily('series-svc-fade'),
          categoryId: BadgeCategoryId.of('cat-gone'),
        },
        FIXTURE_TODAY,
      ),
    ).toEqual([]);
  });
});

describe('shelves, windowFamilies and anyUnderWay (the medals page)', () => {
  const shelvesOf = (
    catalog: typeof FIXTURE_CATALOG,
    progress: readonly BadgeProgress[],
    rhythmLive: boolean,
  ) =>
    StandingSystem.shelves(catalog, progress, FIXTURE_TODAY, rhythmLive).map(
      ({ category, families }) => [category.id, families.length],
    );

  it('draws every shelf but the records’ in the catalogue’s order, with all its families', () => {
    expect(shelvesOf(FIXTURE_CATALOG, GEORGI, true)).toEqual([
      ['cat-milestones', 5],
      ['cat-mastery', 9],
      ['cat-barbers', 7],
      ['cat-rhythm', 3],
      ['cat-special', 7],
    ]);
    // Even with nothing started: the requirement is never hidden.
    expect(shelvesOf(FIXTURE_CATALOG, [], true)).toEqual(
      shelvesOf(FIXTURE_CATALOG, GEORGI, true),
    );
  });

  it('never draws the records’ shelf, whatever it holds', () => {
    const filed = fixtureCatalogWith((parts) => ({
      ...parts,
      series: parts.series.map((family) =>
        family.id === 'series-profile'
          ? { ...family, categoryId: BadgeCategoryId.of('cat-records') }
          : family,
      ),
    }));
    expect(shelvesOf(filed, GEORGI, true).map(([id]) => id)).not.toContain(
      'cat-records',
    );
  });

  it('cuts the rhythm’s shelf to what was earned while the shop runs no rhythm, and drops it where nothing was', () => {
    // The rule in force switched off: the page reads it through rhythmLive.
    const live = LoyaltyCatalogSystem.rhythmLive(
      RHYTHM_OFF,
      FIXTURE_TODAY,
      true,
    );
    expect(live).toBe(false);
    const off = StandingSystem.shelves(
      RHYTHM_OFF,
      GEORGI,
      FIXTURE_TODAY,
      live,
    ).find(({ category }) => category.id === 'cat-rhythm');
    expect(off?.families.map((s) => s.id)).toEqual([
      'series-rhythm',
      'series-twelve-months',
    ]);
    expect(
      shelvesOf(
        FIXTURE_CATALOG,
        without(GEORGI, 'series-rhythm', 'series-twelve-months'),
        false,
      ).map(([id]) => id),
    ).not.toContain('cat-rhythm');
  });

  it('draws a window’s track, then its own families', () => {
    const autumn = must2(
      LoyaltyCatalogSystem.season(
        FIXTURE_CATALOG,
        SeasonId.of('season-2026-autumn'),
      ),
    );
    expect(
      StandingSystem.windowFamilies(
        FIXTURE_CATALOG,
        GEORGI,
        autumn,
        FIXTURE_TODAY,
      ).map((s) => s.id),
    ).toEqual([
      'series-2026-autumn-track',
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
      'series-2026-autumn-referral',
      'series-2026-autumn-early',
    ]);
    const week = must2(
      LoyaltyCatalogSystem.season(
        FIXTURE_CATALOG,
        SeasonId.of('event-2026-beard-week'),
      ),
    );
    expect(
      StandingSystem.windowFamilies(
        FIXTURE_CATALOG,
        GEORGI,
        week,
        FIXTURE_TODAY,
      ).map((s) => s.id),
    ).toEqual(['series-2026-beard-week-beard', 'series-2026-beard-week-full']);
  });

  it('keeps a withdrawn track, started or not: the window draws it', () => {
    const retired = fixtureCatalogWith((parts) => ({
      ...parts,
      series: parts.series.map((family) =>
        family.id === 'series-2026-autumn-track'
          ? {
              ...family,
              retiredAtUtcMs: utcMs('2026-09-20T07:00:00.000Z'),
              retiredLocalDate: localDate('2026-09-20'),
            }
          : family,
      ),
    }));
    const autumn = must2(
      LoyaltyCatalogSystem.season(retired, SeasonId.of('season-2026-autumn')),
    );
    expect(
      StandingSystem.windowFamilies(retired, [], autumn, FIXTURE_TODAY)[0]?.id,
    ).toBe('series-2026-autumn-track');
  });

  it('counts the collection over the shelves and the open windows, an ended season left out', () => {
    const windows = LoyaltyCatalogSystem.windowsOn(
      FIXTURE_CATALOG,
      FIXTURE_TODAY,
    );
    const published = (catalog: typeof FIXTURE_CATALOG, live: boolean) => [
      ...StandingSystem.shelves(catalog, GEORGI, FIXTURE_TODAY, live).flatMap(
        (s) => s.families,
      ),
      ...[
        ...(windows.season === null ? [] : [windows.season]),
        ...windows.events,
      ].flatMap((window) =>
        StandingSystem.windowFamilies(catalog, GEORGI, window, FIXTURE_TODAY),
      ),
    ];
    const on = published(FIXTURE_CATALOG, true);
    expect([StandingSystem.earnedAmong(on, GEORGI), on.length]).toEqual([
      15, 38,
    ]);
    const off = published(FIXTURE_CATALOG, false);
    expect([StandingSystem.earnedAmong(off, GEORGI), off.length]).toEqual([
      15, 37,
    ]);
  });

  it('is under way once a family moved or a level was earned', () => {
    expect(StandingSystem.anyUnderWay(GEORGI)).toBe(true);
    expect(StandingSystem.anyUnderWay([])).toBe(false);
    expect(StandingSystem.anyUnderWay(only(GEORGI, 'series-weekend'))).toBe(
      true,
    );
    const idle = { ...must(GEORGI, 'series-weekend'), value: 0 };
    expect(StandingSystem.anyUnderWay([idle])).toBe(false);
    expect(
      StandingSystem.anyUnderWay([
        { ...must(GEORGI, 'series-welcome'), value: 0 },
      ]),
    ).toBe(true);
  });
});

describe('strip and stripCue (the glance’s medals)', () => {
  const rhythm = seriesId('series-rhythm');
  const newestOf = (progress: readonly BadgeProgress[]) =>
    StandingSystem.recentLevelsByDay(progress, 1)[0]?.levels[0] ?? null;
  const standingOf = (id: string, progress = GEORGI) =>
    BadgeSystem.standing(
      fixtureFamily(id),
      progress.find((p) => p.id === id) ?? null,
    );
  const completingFirst = (completing: ReadonlySet<BadgeSeriesId>) =>
    LoyaltyCatalogSystem.cueOrdered(
      FIXTURE_CATALOG,
      FIXTURE_CATALOG.families.filter((s) => completing.has(s.id)),
    )[0]?.id ?? null;
  const soon = (
    progress: readonly BadgeProgress[],
    completing: ReadonlySet<BadgeSeriesId>,
  ) =>
    StandingSystem.soonIds(
      FIXTURE_CATALOG,
      progress,
      FIXTURE_TODAY,
      completing,
      3,
    );

  it('names three medals on a settled visit: the newest level, then the two closest — only slot 1 «ново»', () => {
    expect(
      StandingSystem.strip({
        completingFirst: completingFirst(NOTHING),
        newestSeriesId: rhythm,
        soonIds: soon(GEORGI, NOTHING),
        limit: 3,
      }),
    ).toEqual({
      slots: ['series-rhythm', 'series-svc-fade', 'series-self-service'],
      markNewIndex: 0,
      closestId: 'series-svc-fade',
    });
  });

  it('leads with the family this very visit completes, the newest level after it, nothing marked', () => {
    expect(
      StandingSystem.strip({
        completingFirst: completingFirst(GEORGI_OPEN),
        newestSeriesId: rhythm,
        soonIds: soon(GEORGI, GEORGI_OPEN),
        limit: 3,
      }),
    ).toEqual({
      slots: ['series-visits', 'series-rhythm', 'series-svc-fade'],
      markNewIndex: null,
      closestId: 'series-svc-fade',
    });
  });

  it('puts Мартин’s birthday visit on the strip, then his newest level, then the closest', () => {
    expect(
      StandingSystem.strip({
        completingFirst: completingFirst(MARTIN_BIRTHDAY),
        newestSeriesId: seriesId('series-2026-summer-track'),
        soonIds: soon(MARTIN, MARTIN_BIRTHDAY),
        limit: 3,
      }),
    ).toEqual({
      slots: [
        'series-birthday',
        'series-2026-summer-track',
        'series-twelve-months',
      ],
      markNewIndex: null,
      // «Скоро» leads with the single act the visit completes.
      closestId: 'series-birthday',
    });
  });

  it('draws each family once, at most the limit, and marks nothing without a newest level', () => {
    expect(
      StandingSystem.strip({
        completingFirst: seriesId('series-svc-fade'),
        newestSeriesId: seriesId('series-svc-fade'),
        soonIds: [seriesId('series-svc-fade'), seriesId('series-visits')],
        limit: 3,
      }),
    ).toEqual({
      slots: ['series-svc-fade', 'series-visits'],
      markNewIndex: null,
      closestId: 'series-visits',
    });
    expect(
      StandingSystem.strip({
        completingFirst: null,
        newestSeriesId: null,
        soonIds: soon(GEORGI, NOTHING),
        limit: 2,
      }),
    ).toEqual({
      slots: ['series-svc-fade', 'series-self-service'],
      markNewIndex: null,
      closestId: 'series-svc-fade',
    });
    expect(
      StandingSystem.strip({
        completingFirst: null,
        newestSeriesId: rhythm,
        soonIds: [],
        limit: 0,
      }),
    ).toEqual({ slots: [], markNewIndex: null, closestId: null });
  });

  it('names «Скоро»’s first family beside the newest one’s as the closest, whatever the limit', () => {
    // The newest family keeps its own slot: «Скоро» is read beside it.
    expect(
      StandingSystem.strip({
        completingFirst: null,
        newestSeriesId: rhythm,
        soonIds: [rhythm, seriesId('series-svc-fade')],
        limit: 3,
      }).closestId,
    ).toBe('series-svc-fade');
    // A full strip still names it — the CLOSE cue measures it, drawn or not.
    expect(
      StandingSystem.strip({
        completingFirst: seriesId('series-visits'),
        newestSeriesId: rhythm,
        soonIds: [seriesId('series-self-service')],
        limit: 2,
      }),
    ).toEqual({
      slots: ['series-visits', 'series-rhythm'],
      markNewIndex: null,
      closestId: 'series-self-service',
    });
    // Only the newest family in «Скоро»: none.
    expect(
      StandingSystem.strip({
        completingFirst: null,
        newestSeriesId: rhythm,
        soonIds: [rhythm],
        limit: 3,
      }).closestId,
    ).toBeNull();
  });

  it('cues what this very visit completes first, naming the level it reaches', () => {
    expect(
      StandingSystem.stripCue({
        completing: {
          series: fixtureFamily('series-visits'),
          standing: standingOf('series-visits'),
        },
        newest: newestOf(GEORGI),
        previousVisitAtUtcMs: GEORGI_PREVIOUS,
        closest: standingOf('series-svc-fade'),
      }),
    ).toEqual({ medalCue: MedalCue.WithThisVisit, level: 4 });
  });

  it('cues Мартин’s birthday act with no level: a single act has none', () => {
    expect(
      StandingSystem.stripCue({
        completing: {
          series: fixtureFamily('series-birthday'),
          standing: standingOf('series-birthday', MARTIN),
        },
        newest: newestOf(MARTIN),
        previousVisitAtUtcMs: null,
        closest: null,
      }),
    ).toEqual({ medalCue: MedalCue.WithThisVisit, level: null });
  });

  it('cues the newest level when it came since the previous visit, naming the level it is handed', () => {
    const newest = must2(newestOf(GEORGI));
    expect(
      StandingSystem.stripCue({
        completing: null,
        newest,
        previousVisitAtUtcMs: GEORGI_PREVIOUS,
        closest: standingOf('series-svc-fade'),
      }),
    ).toEqual({ medalCue: MedalCue.New, level: 5 });
    // Three levels share 28.09's stamp: the cue reads the face's level,
    // never the latest stamp's.
    const autumn = must2(
      StandingSystem.recentLevelsByDay(GEORGI, 1)[0]?.levels.find(
        (l) => l.badgeSeriesId === AUTUMN_TRACK,
      ),
    );
    expect(autumn.earnedAtUtcMs).toBe(newest.earnedAtUtcMs);
    expect(
      StandingSystem.stripCue({
        completing: null,
        newest: autumn,
        previousVisitAtUtcMs: GEORGI_PREVIOUS,
        closest: null,
      }),
    ).toEqual({ medalCue: MedalCue.New, level: 2 });
  });

  it('cues the closest level when nothing is new and nothing completes, and none past that', () => {
    const after = utcMs('2026-09-28T08:00:00.000Z');
    expect(
      StandingSystem.stripCue({
        completing: null,
        newest: newestOf(GEORGI),
        previousVisitAtUtcMs: after,
        closest: standingOf('series-svc-fade'),
      }),
    ).toEqual({ medalCue: MedalCue.Close, level: 3 });
    // «Добре дошъл» is done: no next level to be close to.
    expect(
      StandingSystem.stripCue({
        completing: null,
        newest: newestOf(GEORGI),
        previousVisitAtUtcMs: after,
        closest: standingOf('series-welcome'),
      }),
    ).toEqual({ medalCue: null, level: null });
    expect(
      StandingSystem.stripCue({
        completing: null,
        newest: null,
        previousVisitAtUtcMs: null,
        closest: null,
      }),
    ).toEqual({ medalCue: null, level: null });
  });
});

describe('StandingSystem purity — the medals page and the strip', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const catalog = deepFreeze(FIXTURE_CATALOG);
    const progress = deepFreeze([...GEORGI]);
    const completing = GEORGI_OPEN;
    const run = () => [
      StandingSystem.isFamilyNew(
        { medalState: MedalState.Earned },
        progress[0]?.earned[0] ?? null,
        GEORGI_PREVIOUS,
      ),
      StandingSystem.shelfOrdered(catalog.families, progress),
      StandingSystem.soonIds(catalog, progress, FIXTURE_TODAY, completing, 3),
      StandingSystem.almostEarned(catalog, progress, FIXTURE_TODAY, {
        completing,
        excludeSeriesId: AUTUMN_TRACK,
        rhythmLive: false,
        limit: 3,
      }),
      StandingSystem.recentFreshLevelsByDay(progress),
      StandingSystem.earnedAmong(catalog.families, progress),
      StandingSystem.earnedOnly(catalog.families, progress),
      StandingSystem.seasonListed(
        {
          windowFrom: localDate('2026-06-01'),
          windowUntil: localDate('2026-08-31'),
        },
        catalog.families,
        progress,
        FIXTURE_TODAY,
      ),
      StandingSystem.seasonListed(
        {
          windowFrom: localDate('2026-09-01'),
          windowUntil: localDate('2026-11-30'),
        },
        catalog.families,
        progress,
        FIXTURE_TODAY,
      ),
      StandingSystem.scopeMedalState({ started: 1, earned: 0, total: 3 }),
      StandingSystem.sectionsOf(
        BadgeCategoryKind.Barbers,
        catalog.families,
        new Map(),
      ),
      StandingSystem.neighboursOf(
        catalog,
        progress,
        fixtureFamily('series-svc-fade'),
        FIXTURE_TODAY,
      ),
      StandingSystem.shelves(catalog, progress, FIXTURE_TODAY, false),
      StandingSystem.windowFamilies(
        catalog,
        progress,
        { id: SeasonId.of('season-2026-autumn'), trackSeriesId: AUTUMN_TRACK },
        FIXTURE_TODAY,
      ),
      StandingSystem.anyUnderWay(progress),
      StandingSystem.strip({
        completingFirst: null,
        newestSeriesId: seriesId('series-rhythm'),
        soonIds: [seriesId('series-svc-fade')],
        limit: 3,
      }),
      StandingSystem.stripCue({
        completing: null,
        newest: null,
        previousVisitAtUtcMs: null,
        closest: BadgeSystem.standing(fixtureFamily('series-svc-fade'), null),
      }),
    ];
    expect(run()).toEqual(run());
  });
});

function must(progress: readonly BadgeProgress[], id: string): BadgeProgress {
  const found = progress.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no progress for ${id}`);
  return found;
}

function must2<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}
