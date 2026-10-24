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
  BarberId,
  CouponId,
  RewardId,
  SeasonId,
  StreakDefinitionId,
  TierId,
} from '@core/primitives';
import {
  FIXTURE_TODAY,
  deepFreeze,
  localDate,
  loyaltyCatalogFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
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

  /** A schedule of the validated catalogue, by id. */
  const head = (
    catalog: { readonly streaks: readonly StreakDefinition[] },
    id: string,
  ): StreakDefinition | null =>
    catalog.streaks.find((s) => s.id === StreakDefinitionId.of(id)) ?? null;

  it('is a catalogue without one: the schedules are none by default', () => {
    const catalog = must(parts());
    expect(catalog.streaks).toEqual([]);
  });

  it('hands the schedules back sorted by id, their rules intact', () => {
    const catalog = must(withRhythm());
    expect(catalog.streaks.map((s) => s.id)).toEqual(['cadence', 'comeback']);
    const comeback = head(catalog, 'comeback');
    expect(
      comeback === null ? null : StreakRuleSystem.current(comeback).version,
    ).toBe(3);
  });

  it.each([
    { today: '2026-09-29', version: 3, days: 42 },
    { today: '2026-09-30', version: 3, days: 42 },
    { today: '2026-10-01', version: 4, days: 35 },
    { today: '2026-11-15', version: 4, days: 35 },
  ])(
    'resolves the rule in force by date: version $version on $today',
    ({ today, version, days }) => {
      const cadence = head(must(withRhythm()), 'cadence');
      const inForce =
        cadence === null
          ? null
          : StreakRuleSystem.inForceOn(cadence, localDate(today));
      expect(inForce?.version).toBe(version);
      expect(
        inForce === null
          ? null
          : StreakIntervalRule.daysFor(inForce, null).days,
      ).toBe(days);
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
    const cadence = head(must({ ...parts(), streaks: [off] }), 'cadence');
    expect(
      cadence === null
        ? null
        : StreakRuleSystem.inForceOn(cadence, localDate('2026-09-29')).enabled,
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

// ── The pages' reading of the catalogue (Law 10.2, the decision pass) ──

describe('LoyaltyCatalogSystem.inEndedSeason', () => {
  const catalog = must(parts());
  const family = (id: string) => {
    const found = LoyaltyCatalogSystem.series(catalog, BadgeSeriesId.of(id));
    if (found === null) throw new Error(`no family ${id}`);
    return found;
  };

  it('is a family whose window ended on the day, both ends inclusive', () => {
    const today = localDate('2026-09-28');
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        family('series-summer-track'),
        today,
      ),
    ).toBe(true);
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        family('series-autumn-beard'),
        today,
      ),
    ).toBe(false);
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        family('series-autumn-beard'),
        localDate('2026-11-30'),
      ),
    ).toBe(false);
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        family('series-autumn-beard'),
        localDate('2026-12-01'),
      ),
    ).toBe(true);
  });

  it('is never a shelf’s family, nor one of a season the catalogue lacks', () => {
    const today = localDate('2027-06-01');
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        family('series-svc-fade'),
        today,
      ),
    ).toBe(false);
    expect(
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        { seasonId: SeasonId.of('season-gone') },
        today,
      ),
    ).toBe(false);
  });
});

describe('LoyaltyCatalogSystem.windowsOn', () => {
  const ids = (windows: {
    readonly season: Season | null;
    readonly events: readonly Season[];
  }) => [windows.season?.id ?? null, windows.events.map((e) => e.id)];

  it('is the running season and the events open on the day', () => {
    expect(
      ids(
        LoyaltyCatalogSystem.windowsOn(must(parts()), localDate('2026-09-28')),
      ),
    ).toEqual(['season-autumn', ['event-beard-week']]);
  });

  it('lists the open events before the announced ones, and never an announced season', () => {
    const catalog = must({
      ...parts(),
      series: [
        ...parts().series,
        series('series-shave-week', { seasonId: 'event-shave-week' }, 50),
      ],
      seasons: [
        ...parts().seasons,
        season(
          'event-shave-week',
          { from: '2026-10-20', until: '2026-10-25' },
          { track: null, rest: ['series-shave-week'] },
        ),
      ],
    });
    expect(
      ids(LoyaltyCatalogSystem.windowsOn(catalog, localDate('2026-09-28'))),
    ).toEqual(['season-autumn', ['event-beard-week', 'event-shave-week']]);
    // Before anything opens: the announced event, no season yet.
    expect(
      ids(LoyaltyCatalogSystem.windowsOn(catalog, localDate('2026-05-01'))),
    ).toEqual([null, ['event-beard-week', 'event-shave-week']]);
  });

  it('is nothing once every window ended', () => {
    expect(
      ids(
        LoyaltyCatalogSystem.windowsOn(must(parts()), localDate('2027-06-01')),
      ),
    ).toEqual([null, []]);
  });
});

describe('LoyaltyCatalogSystem.archivedFor', () => {
  const catalog = must(parts());
  const archived = (
    today: string,
    started: readonly string[],
    progressed: readonly string[],
  ) =>
    LoyaltyCatalogSystem.archivedFor(
      catalog,
      localDate(today),
      new Set(started.map(BadgeSeriesId.of)),
      new Set(progressed.map(SeasonId.of)),
    ).map((s) => s.id);

  it('keeps the ended windows the client took part in, newest first', () => {
    // A track value of the summer's; a family of the beard week started.
    expect(
      archived('2026-12-15', ['series-week-beard'], ['season-summer']),
    ).toEqual(['event-beard-week', 'season-summer']);
    // The track counts as the window's family too.
    expect(archived('2026-12-15', ['series-autumn-track'], [])).toEqual([
      'season-autumn',
    ]);
  });

  it('leaves out the windows never joined, and the ones still running', () => {
    expect(archived('2026-12-15', [], [])).toEqual([]);
    expect(
      archived('2026-09-28', ['series-autumn-beard'], ['season-autumn']),
    ).toEqual([]);
  });
});

describe('LoyaltyCatalogSystem.rhythmLive', () => {
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
  const today = localDate('2026-09-29');

  it('is a head whose rule in force is switched on', () => {
    expect(
      LoyaltyCatalogSystem.rhythmLive(
        must({ ...parts(), streaks: [schedule('cadence')] }),
        today,
        true,
      ),
    ).toBe(true);
    expect(
      LoyaltyCatalogSystem.rhythmLive(
        must({ ...parts(), streaks: [off, schedule('comeback')] }),
        today,
        true,
      ),
    ).toBe(true);
  });

  it('is off with every rule off, and in a shop without a rhythm', () => {
    expect(
      LoyaltyCatalogSystem.rhythmLive(
        must({ ...parts(), streaks: [off] }),
        today,
        true,
      ),
    ).toBe(false);
    expect(LoyaltyCatalogSystem.rhythmLive(must(parts()), today, true)).toBe(
      false,
    );
  });

  it('takes the caller’s flag over a rule that is on, never the other way', () => {
    expect(
      LoyaltyCatalogSystem.rhythmLive(
        must({ ...parts(), streaks: [schedule('cadence')] }),
        today,
        false,
      ),
    ).toBe(false);
  });

  it('agrees with StreakRuleSystem.isOnOn on the same catalogue, the flag aside', () => {
    for (const streaks of [
      [schedule('cadence')],
      [off],
      [off, schedule('comeback')],
      [],
    ]) {
      const catalog = must({ ...parts(), streaks });
      for (const flag of [true, false]) {
        expect(LoyaltyCatalogSystem.rhythmLive(catalog, today, flag)).toBe(
          catalog.streaks.some((head) =>
            StreakRuleSystem.isOnOn(head, today, flag),
          ),
        );
      }
    }
  });
});

describe('LoyaltyCatalogSystem.barberIds', () => {
  const fixture = unwrapOk(
    LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
  );

  it('names the barbers of the families about one, each once, in the catalogue’s order', () => {
    expect(LoyaltyCatalogSystem.barberIds(fixture)).toEqual([
      'ivan',
      'niko',
      'stefan',
    ]);
  });

  it('leaves out a withdrawn family’s barber, and names a barber with two families once', () => {
    const edited = unwrapOk(
      LoyaltyCatalogSystem.validate({
        ...loyaltyCatalogFixture(),
        series: loyaltyCatalogFixture().series.flatMap((family) =>
          family.id === 'series-barber-niko'
            ? [
                {
                  ...family,
                  retiredAtUtcMs: utcMs('2026-01-01T00:00:00.000Z'),
                  retiredLocalDate: localDate('2026-01-01'),
                },
              ]
            : family.id === 'series-barber-ivan'
              ? [
                  family,
                  {
                    ...family,
                    id: BadgeSeriesId.of('series-barber-ivan-beard'),
                    order: 99,
                  },
                ]
              : [family],
        ),
      }),
    );
    expect(LoyaltyCatalogSystem.barberIds(edited)).toEqual([
      BarberId.of('ivan'),
      BarberId.of('stefan'),
    ]);
    expect(LoyaltyCatalogSystem.barberIds(must(parts()))).toEqual([]);
  });
});

describe('LoyaltyCatalogSystem.shelfRank — where a family’s shelf stands', () => {
  const shelves = {
    categories: [
      { id: BadgeCategoryId.of('cat-mastery'), order: 2 },
      { id: BadgeCategoryId.of('cat-milestones'), order: 0 },
    ],
  };

  it('ranks a family by its shelf’s order', () => {
    expect(
      LoyaltyCatalogSystem.shelfRank(shelves, {
        categoryId: BadgeCategoryId.of('cat-milestones'),
      }),
    ).toBe(0);
    expect(
      LoyaltyCatalogSystem.shelfRank(shelves, {
        categoryId: BadgeCategoryId.of('cat-mastery'),
      }),
    ).toBe(2);
  });

  it('ranks a family of no shelf after every shelf', () => {
    expect(LoyaltyCatalogSystem.shelfRank(shelves, { categoryId: null })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('ranks a family of a shelf the catalogue lacks after every shelf too', () => {
    expect(
      LoyaltyCatalogSystem.shelfRank(shelves, {
        categoryId: BadgeCategoryId.of('cat-gone'),
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      LoyaltyCatalogSystem.shelfRank(
        { categories: [] },
        { categoryId: BadgeCategoryId.of('cat-mastery') },
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('gives two families of one shelf one rank — the series order breaks the tie', () => {
    const a = { categoryId: BadgeCategoryId.of('cat-mastery') };
    const b = { categoryId: BadgeCategoryId.of('cat-mastery') };
    expect(LoyaltyCatalogSystem.shelfRank(shelves, a)).toBe(
      LoyaltyCatalogSystem.shelfRank(shelves, b),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const catalog = deepFreeze(shelves);
    const series = deepFreeze({
      categoryId: BadgeCategoryId.of('cat-mastery'),
    });
    const once = LoyaltyCatalogSystem.shelfRank(catalog, series);
    expect(LoyaltyCatalogSystem.shelfRank(catalog, series)).toBe(once);
    expect(series).toEqual({ categoryId: 'cat-mastery' });
    expect(catalog.categories.map((c) => c.order)).toEqual([2, 0]);
  });
});

describe('LoyaltyCatalogSystem.cueOrdered', () => {
  const fixture = unwrapOk(
    LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
  );
  const family = (id: string) => {
    const found = LoyaltyCatalogSystem.series(fixture, BadgeSeriesId.of(id));
    if (found === null) throw new Error(`no family ${id}`);
    return found;
  };

  it('names shelves before seasons — by the shelf’s order, then the family’s', () => {
    // What Георги's next fade with Иван at 10:00 completes, as they come.
    const completing = [
      'series-2026-autumn-track',
      'series-early-bird',
      'series-shop-center',
      'series-barber-ivan',
      'series-svc-fade',
      'series-visits',
    ].map(family);
    expect(
      LoyaltyCatalogSystem.cueOrdered(fixture, completing).map((s) => s.id),
    ).toEqual([
      'series-visits',
      'series-svc-fade',
      'series-barber-ivan',
      'series-shop-center',
      'series-early-bird',
      'series-2026-autumn-track',
    ]);
  });

  it('breaks a shelf tie by the family’s own order', () => {
    const first = { ...family('series-svc-fade'), order: 9 };
    const second = { ...family('series-svc-fade'), order: 1 };
    expect(
      LoyaltyCatalogSystem.cueOrdered(fixture, [first, second]).map(
        (s) => s.order,
      ),
    ).toEqual([1, 9]);
  });

  it('puts a family of a shelf the catalogue lacks with the seasons’, by its order, and keeps a full tie as it came', () => {
    const lost = {
      ...family('series-visits'),
      categoryId: BadgeCategoryId.of('cat-gone'),
      order: 3,
    };
    const twin = { ...family('series-2026-autumn-early'), order: 1 };
    expect(
      LoyaltyCatalogSystem.cueOrdered(fixture, [
        family('series-2026-autumn-beard'),
        lost,
        twin,
        family('series-2026-autumn-track'),
        family('series-birthday'),
      ]).map((s) => s.id),
    ).toEqual([
      'series-birthday',
      'series-2026-autumn-early',
      'series-2026-autumn-track',
      'series-2026-autumn-beard',
      'series-visits',
    ]);
    expect(LoyaltyCatalogSystem.cueOrdered(fixture, [])).toEqual([]);
  });
});

describe('LoyaltyCatalogSystem purity — the pages’ readings', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const catalog = deepFreeze(
      must({ ...parts(), streaks: [schedule('cadence')] }),
    );
    const fixture = deepFreeze(
      unwrapOk(LoyaltyCatalogSystem.validate(loyaltyCatalogFixture())),
    );
    const started = new Set([BadgeSeriesId.of('series-week-beard')]);
    const run = () => [
      LoyaltyCatalogSystem.inEndedSeason(
        catalog,
        { seasonId: SeasonId.of('season-summer') },
        FIXTURE_TODAY,
      ),
      LoyaltyCatalogSystem.windowsOn(catalog, FIXTURE_TODAY),
      LoyaltyCatalogSystem.archivedFor(
        catalog,
        localDate('2026-12-15'),
        started,
        new Set(),
      ),
      LoyaltyCatalogSystem.rhythmLive(catalog, FIXTURE_TODAY, true),
      LoyaltyCatalogSystem.barberIds(fixture),
      LoyaltyCatalogSystem.cueOrdered(fixture, fixture.families),
      fixture.families.map((s) => LoyaltyCatalogSystem.shelfRank(fixture, s)),
    ];
    expect(run()).toEqual(run());
  });
});
