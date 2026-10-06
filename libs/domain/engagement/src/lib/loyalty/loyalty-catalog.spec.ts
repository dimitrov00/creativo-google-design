import { describe, expect, it } from 'vitest';
import { LocalizedText } from '@creativo/domain/catalog';
import { BadgeCategory } from './badge-category';
import { BadgeSeries, BadgeSeriesProps } from './badge-series';
import type { RewardCatalogItem, TierDefinition } from './catalog-entries';
import { LoyaltyCatalog, LoyaltyCatalogParts } from './loyalty-catalog';
import { Season, SeasonProps } from './season';
import { StreakDefinition, StreakDefinitionProps } from './streak-definition';
import { StreakDefinitionSchedule } from './streak-schedule';

function must<T>(result: {
  isSuccess(): boolean;
  value?: T;
  error?: unknown;
}): T {
  if (!result.isSuccess()) throw new Error(JSON.stringify(result.error));
  return result.value as T;
}

const text = (bg: string, en = bg) =>
  must<LocalizedText>(LocalizedText.create({ bg, en }));

const category = (id: string, order: number) =>
  must<BadgeCategory>(
    BadgeCategory.create({
      id,
      kind: 'milestones',
      title: { bg: id, en: id },
      order,
    }),
  );

const series = (
  id: string,
  home: { categoryId?: string; seasonId?: string },
  order: number,
): BadgeSeries =>
  must<BadgeSeries>(
    BadgeSeries.create({
      id,
      categoryId: home.categoryId ?? null,
      seasonId: home.seasonId ?? null,
      title: { bg: id, en: id },
      requirement: { bg: id, en: id },
      emblem: 'visits',
      subject: null,
      metric: { metric: 'client.visits.completed' },
      art: null,
      levels: [
        {
          level: 1,
          ruleId: `${id}-1`,
          target: 1,
          requirement: { bg: '1', en: '1' },
          awards: [],
        },
      ],
      repeatable: false,
      order,
      retiredAt: null,
      version: 1,
    } satisfies BadgeSeriesProps),
  );

const season = (
  id: string,
  window: { from: string; until: string },
  families: { track: string | null; rest: readonly string[] },
): Season =>
  must<Season>(
    Season.create({
      id,
      kind: families.track === null ? 'event' : 'season',
      title: { bg: id, en: id },
      emblem: 'autumn',
      window,
      trackSeriesId: families.track,
      seriesIds: families.rest,
      announcedAt: new Date('2026-01-01T06:00:00.000Z'),
      version: 1,
    } satisfies SeasonProps),
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

const reward = (
  id: string,
  cost: number,
  order: number,
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
});

/** One version of a rhythm's rule: the recommended one, with what a case changes. */
const rule = (patch: Partial<StreakDefinitionProps> = {}): StreakDefinition =>
  must<StreakDefinition>(
    StreakDefinition.create({
      ...StreakDefinition.default().toProps(),
      version: 3,
      effectiveFrom: '2026-09-01',
      ...patch,
    }),
  );

/** A rhythm's head: six weeks in force, five from 1.10. */
const schedule = (id: string): StreakDefinitionSchedule =>
  must<StreakDefinitionSchedule>(
    StreakDefinitionSchedule.create({
      current: rule({ id }),
      scheduled: {
        definition: rule({
          id,
          version: 4,
          effectiveFrom: '2026-10-01',
          interval: { kind: 'fixed', days: 35 },
        }),
        transition: 'grandfather',
      },
    }),
  );

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
  };
}

function codes(p: LoyaltyCatalogParts): string[] {
  const result = LoyaltyCatalog.create(p);
  return result.isFailure() ? result.error.map((e) => e.code) : [];
}

describe('LoyaltyCatalog.create', () => {
  const catalog = must<LoyaltyCatalog>(LoyaltyCatalog.create(parts()));

  it('hands every list back in display order', () => {
    expect(catalog.categories.map((c) => c.id.value)).toEqual([
      'cat-milestones',
      'cat-mastery',
    ]);
    expect(catalog.families.map((s) => s.id.value).slice(0, 3)).toEqual([
      'series-visits',
      'series-svc-fade',
      'series-svc-beard',
    ]);
    expect(catalog.seasons.map((s) => s.id.value)).toEqual([
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
    expect(catalog.category('cat-mastery')?.order).toBe(2);
    expect(catalog.category('cat-special')).toBeNull();
    expect(catalog.series('series-svc-fade')?.order).toBe(7);
    expect(catalog.series('series-nope')).toBeNull();
    expect(catalog.season('season-autumn')?.kind).toBe('season');
    expect(catalog.season('season-spring')).toBeNull();
    expect(catalog.tier('silver')?.rank).toBe(1);
    expect(catalog.tier('platinum')).toBeNull();
    expect(catalog.streakSchedule('cadence')).toBeNull();
  });

  it('lists a shelf’s families by order', () => {
    expect(catalog.seriesIn('cat-mastery').map((s) => s.id.value)).toEqual([
      'series-svc-fade',
      'series-svc-beard',
    ]);
    expect(catalog.seriesIn('cat-records')).toEqual([]);
  });

  describe('seasonsIn', () => {
    const on = (phase: 'announced' | 'open' | 'ended', today: string) =>
      catalog.seasonsIn(phase, today).map((s) => s.id.value);

    it('lists the running windows in the order they opened', () => {
      expect(on('open', '2026-09-28')).toEqual([
        'season-autumn',
        'event-beard-week',
      ]);
    });

    it('lists what is announced', () => {
      expect(on('announced', '2026-09-28')).toEqual(['season-winter']);
    });

    it('lists the ended windows newest first', () => {
      expect(on('ended', '2026-12-15')).toEqual([
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
    ).toEqual(['engagement.loyalty_catalog.dangling_category']);
  });

  it('refuses a family in a season the catalogue lacks', () => {
    const p = parts();
    expect(
      codes({
        ...p,
        series: [...p.series, series('series-y', { seasonId: 'season-y' }, 9)],
      }),
    ).toEqual(['engagement.loyalty_catalog.dangling_season']);
  });

  it('refuses a season listing a family that is missing, or another season’s', () => {
    const p = parts();
    const listsMissing = season(
      'season-spring',
      { from: '2026-03-01', until: '2026-05-31' },
      { track: 'series-spring-track', rest: ['series-autumn-beard'] },
    );
    expect(codes({ ...p, seasons: [...p.seasons, listsMissing] })).toEqual([
      'engagement.loyalty_catalog.dangling_season',
      'engagement.loyalty_catalog.dangling_season',
    ]);
  });

  it('refuses an id listed twice', () => {
    const p = parts();
    expect(
      codes({ ...p, rewards: [...p.rewards, reward('reward-cut', 300, 3)] }),
    ).toEqual(['engagement.loyalty_catalog.duplicate_id']);
  });

  it('refuses tiers that do not ask more as they rank higher', () => {
    const p = parts();
    expect(
      codes({ ...p, tiers: [...p.tiers, tier('platinum', 3, 12)] }),
    ).toEqual(['engagement.loyalty_catalog.tiers_not_rising']);
  });

  it.each([0, -120, 12.5])('refuses a reward costing %s', (cost) => {
    const p = parts();
    expect(codes({ ...p, rewards: [reward('reward-free', cost, 1)] })).toEqual([
      'engagement.loyalty_catalog.cost_not_positive',
    ]);
  });
});

describe('LoyaltyCatalog, the rhythm', () => {
  const withRhythm = (): LoyaltyCatalogParts => ({
    ...parts(),
    streakSchedules: [schedule('comeback'), schedule('cadence')],
  });

  it('is a catalogue without one: the schedules are optional, and none by default', () => {
    const catalog = must<LoyaltyCatalog>(LoyaltyCatalog.create(parts()));
    expect(catalog.streakSchedules).toEqual([]);
    expect(catalog.streakSchedule('cadence')).toBeNull();
    expect(catalog.streakInForce('cadence', '2026-09-29')).toBeNull();
  });

  it('hands the schedules back by id', () => {
    const catalog = must<LoyaltyCatalog>(LoyaltyCatalog.create(withRhythm()));
    expect(catalog.streakSchedules.map((s) => s.id)).toEqual([
      'cadence',
      'comeback',
    ]);
    expect(catalog.streakSchedule('comeback')?.current.version).toBe(3);
    expect(catalog.streakSchedule('nope')).toBeNull();
  });

  it.each([
    { today: '2026-09-29', version: 3, days: 42 },
    { today: '2026-09-30', version: 3, days: 42 },
    { today: '2026-10-01', version: 4, days: 35 },
    { today: '2026-11-15', version: 4, days: 35 },
  ])(
    'resolves the rule in force by date: version $version on $today',
    ({ today, version, days }) => {
      const catalog = must<LoyaltyCatalog>(LoyaltyCatalog.create(withRhythm()));
      const inForce = catalog.streakInForce('cadence', today);
      expect(inForce?.version).toBe(version);
      expect(inForce?.interval.daysFor(null).days).toBe(days);
      expect(catalog.streakInForce('nope', today)).toBeNull();
    },
  );

  it('hands a rule that is off over as the rule in force', () => {
    const off = must<StreakDefinitionSchedule>(
      StreakDefinitionSchedule.create({
        current: rule({ enabled: false }),
        scheduled: null,
      }),
    );
    const catalog = must<LoyaltyCatalog>(
      LoyaltyCatalog.create({ ...parts(), streakSchedules: [off] }),
    );
    expect(catalog.streakInForce('cadence', '2026-09-29')?.enabled).toBe(false);
  });

  it('refuses a schedule listed twice', () => {
    const result = LoyaltyCatalog.create({
      ...parts(),
      streakSchedules: [schedule('cadence'), schedule('cadence')],
    });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.loyalty_catalog.duplicate_id',
      collection: 'streakDefinitions',
      id: 'cadence',
    });
  });
});
