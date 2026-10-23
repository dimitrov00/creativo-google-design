import { describe, expect, it } from 'vitest';
import {
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubjectSlot,
  Metric,
  MetricRef,
  SeasonKind,
  SeasonPhase,
  Points,
  RewardGrantRule,
  StreakIntervalRule,
  HeadRole,
  StreakRule,
  StreakTransition,
} from '@core/components';
import type {
  BadgeCategory,
  BadgeSeries,
  RewardCatalogItem,
  Season,
  StreakDefinition,
  TierDefinition,
} from '@core/entities';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  CouponId,
  RewardId,
  SeasonId,
  StreakDefinitionId,
  TierId,
} from '@core/primitives';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import {
  LoyaltyCatalogSystem,
  type ValidLoyaltyCatalog,
  type LoyaltyCatalogParts,
} from './loyalty-catalog.system';
import { StreakRuleSystem } from './streak-rule.system';

/*
 * The cases of the legacy engagement `loyalty-catalog.spec.ts` (deleted in
 * Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED
 * while it still ran against `ValidLoyaltyCatalog`'s shim, and re-targeted: the
 * rows are the flat entities, the catalogue a struct, its lookups
 * `LoyaltyCatalogSystem` functions over it (by branded ids), and the rhythm's
 * heads `streaks` (`StreakDefinition`, its `rules` list), `[]` for none.
 */

const text = (bg: string, en = bg) => ({ bg, en });

const category = (id: string, order: number): BadgeCategory => ({
  id: BadgeCategoryId.of(id),
  badgeCategoryKind: BadgeCategoryKind.Milestones,
  title: text(id),
  order,
});

const series = (
  id: string,
  home: { categoryId?: string; seasonId?: string },
  order: number,
): BadgeSeries => ({
  id: BadgeSeriesId.of(id),
  categoryId:
    home.categoryId === undefined ? null : BadgeCategoryId.of(home.categoryId),
  seasonId: home.seasonId === undefined ? null : SeasonId.of(home.seasonId),
  title: text(id),
  requirement: text(id),
  emblem: BadgeEmblem.Visits,
  ...BadgeSubjectSlot.none(),
  ...MetricRef.of(Metric.VisitsCompleted),
  artPath: null,
  levels: [
    {
      level: 1,
      ruleId: AchievementRuleId.of(`${id}-1`),
      target: 1,
      requirement: text('1'),
      awards: [],
    },
  ],
  repeatable: false,
  order,
  retiredAtUtcMs: null,
  retiredLocalDate: null,
  version: 1,
});

const season = (
  id: string,
  window: { from: string; until: string },
  families: { track: string | null; rest: readonly string[] },
): Season => ({
  id: SeasonId.of(id),
  seasonKind: families.track === null ? SeasonKind.Event : SeasonKind.Season,
  title: text(id),
  emblem: BadgeEmblem.Autumn,
  windowFrom: localDate(window.from),
  windowUntil: localDate(window.until),
  trackSeriesId:
    families.track === null ? null : BadgeSeriesId.of(families.track),
  seriesIds: families.rest.map(BadgeSeriesId.of),
  announcedAtUtcMs: utcMs('2026-01-01T06:00:00.000Z'),
  announcedLocalDate: localDate('2026-01-01'),
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

const reward = (
  id: string,
  cost: number,
  order: number,
): RewardCatalogItem => ({
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
});

/** One version of a rhythm's rule: the recommended one, with what a case changes. */
const rule = (patch: Partial<StreakRule.Options> = {}): StreakRule => ({
  ...StreakRule.DEFAULT,
  version: 3,
  effectiveFromLocalDate: localDate('2026-09-01'),
  ...patch,
});

/** A rhythm's head: six weeks in force, five from 1.10. */
const schedule = (id: string): StreakDefinition => ({
  id: StreakDefinitionId.of(id),
  name: StreakRule.DEFAULT_NAME,
  rules: [
    { ...rule(), headRole: HeadRole.Current, streakTransition: null },
    {
      ...rule({ version: 4, effectiveFromLocalDate: localDate('2026-10-01') }),
      ...StreakIntervalRule.fixed(35),
      headRole: HeadRole.Scheduled,
      streakTransition: StreakTransition.Grandfather,
    },
  ],
  updatedAtUtcMs: utcMs('2026-09-01T06:00:00.000Z'),
});

function parts(): LoyaltyCatalogParts {
  return {
    categories: [category('cat-mastery', 2), category('cat-milestones', 1)],
    series: [
      series('series-svc-fade', { categoryId: 'cat-mastery' }, 7),
      series('series-visits', { categoryId: 'cat-milestones' }, 1),
      series('series-svc-beard', { categoryId: 'cat-mastery' }, 8),
      series('series-summer-track', { seasonId: 'season-summer' }, 39),
      series('series-autumn-track', { seasonId: 'season-autumn' }, 32),
      series('series-autumn-beard', { seasonId: 'season-autumn' }, 34),
      series('series-week-beard', { seasonId: 'event-beard-week' }, 37),
      series('series-winter-track', { seasonId: 'season-winter' }, 43),
    ],
    seasons: [
      season(
        'season-autumn',
        { from: '2026-09-01', until: '2026-11-30' },
        { track: 'series-autumn-track', rest: ['series-autumn-beard'] },
      ),
      season(
        'season-summer',
        { from: '2026-06-01', until: '2026-08-31' },
        { track: 'series-summer-track', rest: [] },
      ),
      season(
        'event-beard-week',
        { from: '2026-09-22', until: '2026-10-05' },
        { track: null, rest: ['series-week-beard'] },
      ),
      season(
        'season-winter',
        { from: '2026-12-01', until: '2027-02-28' },
        { track: 'series-winter-track', rest: [] },
      ),
    ],
    tiers: [tier('gold', 2, 12), tier('bronze', 0, 0), tier('silver', 1, 6)],
    rewards: [reward('reward-cut', 250, 2), reward('reward-beard', 120, 1)],
    streaks: [],
  };
}

function must(p: LoyaltyCatalogParts): ValidLoyaltyCatalog {
  const result = LoyaltyCatalogSystem.validate(p);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function codes(p: LoyaltyCatalogParts): string[] {
  const result = LoyaltyCatalogSystem.validate(p);
  return result.ok ? [] : result.error.map((e) => e.errorCode);
}

describe('LoyaltyCatalogSystem.validate', () => {
  const catalog = must(parts());

  it('hands every list back in display order', () => {
    expect(catalog.categories.map((c) => c.id)).toEqual([
      'cat-milestones',
      'cat-mastery',
    ]);
    expect(catalog.families.map((s) => s.id).slice(0, 3)).toEqual([
      'series-visits',
      'series-svc-fade',
      'series-svc-beard',
    ]);
    expect(catalog.seasons.map((s) => s.id)).toEqual([
      'season-summer',
      'season-autumn',
      'event-beard-week',
      'season-winter',
    ]);
    expect(catalog.tiers.map((t) => t.id)).toEqual([
      'bronze',
      'silver',
      'gold',
    ]);
    expect(catalog.rewards.map((r) => r.id)).toEqual([
      'reward-beard',
      'reward-cut',
    ]);
  });

  it('looks things up by id, null for what it does not hold', () => {
    expect(
      LoyaltyCatalogSystem.category(catalog, BadgeCategoryId.of('cat-mastery'))
        ?.order,
    ).toBe(2);
    expect(
      LoyaltyCatalogSystem.category(catalog, BadgeCategoryId.of('cat-special')),
    ).toBeNull();
    expect(
      LoyaltyCatalogSystem.series(catalog, BadgeSeriesId.of('series-svc-fade'))
        ?.order,
    ).toBe(7);
    expect(
      LoyaltyCatalogSystem.series(catalog, BadgeSeriesId.of('series-nope')),
    ).toBeNull();
    expect(
      LoyaltyCatalogSystem.season(catalog, SeasonId.of('season-autumn'))
        ?.seasonKind,
    ).toBe(SeasonKind.Season);
    expect(
      LoyaltyCatalogSystem.season(catalog, SeasonId.of('season-spring')),
    ).toBeNull();
    expect(LoyaltyCatalogSystem.tier(catalog, TierId.of('silver'))?.rank).toBe(
      1,
    );
    expect(
      LoyaltyCatalogSystem.tier(catalog, TierId.of('platinum')),
    ).toBeNull();
    expect(
      LoyaltyCatalogSystem.streak(catalog, StreakDefinitionId.of('cadence')),
    ).toBeNull();
  });

  it('lists a shelf’s families by order', () => {
    expect(
      LoyaltyCatalogSystem.seriesIn(
        catalog,
        BadgeCategoryId.of('cat-mastery'),
      ).map((s) => s.id),
    ).toEqual(['series-svc-fade', 'series-svc-beard']);
    expect(
      LoyaltyCatalogSystem.seriesIn(catalog, BadgeCategoryId.of('cat-records')),
    ).toEqual([]);
  });

  describe('seasonsIn', () => {
    const on = (phase: SeasonPhase, today: string) =>
      LoyaltyCatalogSystem.seasonsIn(catalog, phase, localDate(today)).map(
        (s) => s.id,
      );

    it('lists the running windows in the order they opened', () => {
      expect(on(SeasonPhase.Open, '2026-09-28')).toEqual([
        'season-autumn',
        'event-beard-week',
      ]);
    });

    it('lists what is announced', () => {
      expect(on(SeasonPhase.Announced, '2026-09-28')).toEqual([
        'season-winter',
      ]);
    });

    it('lists the ended windows newest first', () => {
      expect(on(SeasonPhase.Ended, '2026-12-15')).toEqual([
        'season-autumn',
        'event-beard-week',
        'season-summer',
      ]);
    });
  });

  it('refuses a family on a shelf the catalogue lacks', () => {
    const p = parts();
    expect(
      codes({
        ...p,
        series: [...p.series, series('series-x', { categoryId: 'cat-x' }, 9)],
      }),
    ).toEqual(['ENGAGEMENT_LOYALTY_CATALOG_DANGLING_CATEGORY']);
  });

  it('refuses a family in a season the catalogue lacks', () => {
    const p = parts();
    expect(
      codes({
        ...p,
        series: [...p.series, series('series-y', { seasonId: 'season-y' }, 9)],
      }),
    ).toEqual(['ENGAGEMENT_LOYALTY_CATALOG_DANGLING_SEASON']);
  });

  it('refuses a season listing a family that is missing, or another season’s', () => {
    const p = parts();
    const listsMissing = season(
      'season-spring',
      { from: '2026-03-01', until: '2026-05-31' },
      { track: 'series-spring-track', rest: ['series-autumn-beard'] },
    );
    expect(codes({ ...p, seasons: [...p.seasons, listsMissing] })).toEqual([
      'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_SEASON',
      'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_SEASON',
    ]);
  });

  it('refuses an id listed twice', () => {
    const p = parts();
    expect(
      codes({ ...p, rewards: [...p.rewards, reward('reward-cut', 300, 3)] }),
    ).toEqual(['ENGAGEMENT_LOYALTY_CATALOG_DUPLICATE_ID']);
  });

  it('refuses tiers that do not ask more as they rank higher', () => {
    const p = parts();
    const result = LoyaltyCatalogSystem.validate({
      ...p,
      tiers: [...p.tiers, tier('platinum', 3, 12)],
    });
    expect(!result.ok && result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_TIERS_NOT_RISING',
        tierIds: ['bronze', 'silver', 'gold', 'platinum'],
      },
    ]);
  });

  it.each([0, -120, 12.5])('refuses a reward costing %s', (cost) => {
    const p = parts();
    expect(codes({ ...p, rewards: [reward('reward-free', cost, 1)] })).toEqual([
      'ENGAGEMENT_LOYALTY_CATALOG_COST_NOT_POSITIVE',
    ]);
  });
});

describe('LoyaltyCatalogSystem, the rhythm', () => {
  const withRhythm = (): LoyaltyCatalogParts => ({
    ...parts(),
    streaks: [schedule('comeback'), schedule('cadence')],
  });

  it('is a catalogue without one: the schedules are none by default', () => {
    const catalog = must(parts());
    expect(catalog.streaks).toEqual([]);
    expect(
      LoyaltyCatalogSystem.streak(catalog, StreakDefinitionId.of('cadence')),
    ).toBeNull();
    expect(
      LoyaltyCatalogSystem.streakInForce(
        catalog,
        StreakDefinitionId.of('cadence'),
        localDate('2026-09-29'),
      ),
    ).toBeNull();
  });

  it('hands the schedules back by id', () => {
    const catalog = must(withRhythm());
    expect(catalog.streaks.map((s) => s.id)).toEqual(['cadence', 'comeback']);
    const comeback = LoyaltyCatalogSystem.streak(
      catalog,
      StreakDefinitionId.of('comeback'),
    );
    expect(
      comeback === null ? null : StreakRuleSystem.current(comeback).version,
    ).toBe(3);
    expect(
      LoyaltyCatalogSystem.streak(catalog, StreakDefinitionId.of('nope')),
    ).toBeNull();
  });

  it.each([
    { today: '2026-09-29', version: 3, days: 42 },
    { today: '2026-09-30', version: 3, days: 42 },
    { today: '2026-10-01', version: 4, days: 35 },
    { today: '2026-11-15', version: 4, days: 35 },
  ])(
    'resolves the rule in force by date: version $version on $today',
    ({ today, version, days }) => {
      const catalog = must(withRhythm());
      const inForce = LoyaltyCatalogSystem.streakInForce(
        catalog,
        StreakDefinitionId.of('cadence'),
        localDate(today),
      );
      expect(inForce?.version).toBe(version);
      expect(
        inForce === null
          ? null
          : StreakIntervalRule.daysFor(inForce, null).days,
      ).toBe(days);
      expect(
        LoyaltyCatalogSystem.streakInForce(
          catalog,
          StreakDefinitionId.of('nope'),
          localDate(today),
        ),
      ).toBeNull();
    },
  );

  it('hands a rule that is off over as the rule in force', () => {
    const off: StreakDefinition = {
      ...schedule('cadence'),
      rules: [
        {
          ...rule({ enabled: false }),
          headRole: HeadRole.Current,
          streakTransition: null,
        },
      ],
    };
    const catalog = must({ ...parts(), streaks: [off] });
    expect(
      LoyaltyCatalogSystem.streakInForce(
        catalog,
        StreakDefinitionId.of('cadence'),
        localDate('2026-09-29'),
      )?.enabled,
    ).toBe(false);
  });

  it('refuses a schedule listed twice', () => {
    const result = LoyaltyCatalogSystem.validate({
      ...parts(),
      streaks: [schedule('cadence'), schedule('cadence')],
    });
    expect(!result.ok && result.error).toHaveLength(1);
    expect(!result.ok && result.error[0]).toMatchObject({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_DUPLICATE_ID',
      collection: 'streakDefinitions',
      id: 'cadence',
    });
  });
});

describe('LoyaltyCatalogSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const p = deepFreeze({
      ...parts(),
      streaks: [schedule('comeback'), schedule('cadence')],
    });
    const once = LoyaltyCatalogSystem.validate(p);
    const twice = LoyaltyCatalogSystem.validate(p);
    expect(twice).toEqual(once);
    const catalog = must(p);
    expect(
      LoyaltyCatalogSystem.seasonsIn(
        catalog,
        SeasonPhase.Ended,
        localDate('2027-06-01'),
      ),
    ).toEqual(
      LoyaltyCatalogSystem.seasonsIn(
        catalog,
        SeasonPhase.Ended,
        localDate('2027-06-01'),
      ),
    );
  });
});
