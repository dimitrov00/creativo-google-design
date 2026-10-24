import { describe, expect, it } from 'vitest';
import {
  BadgeEmblem,
  EarnedVia,
  SeasonKind,
  SeasonPhase,
  SeasonTrackState,
} from '@core/components';
import type { BadgeProgress, BadgeSeries, Season } from '@core/entities';
import { BadgeSeriesId, SeasonId, type LocalDate } from '@core/primitives';
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
import { LoyaltyCatalogSystem } from './loyalty-catalog.system';
import { SeasonSystem } from './season.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The phase and family cases of the legacy engagement `season.spec.ts`
 * (deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), re-targeted to the flat `Season`: the announcement is
 * `announcedAtUtcMs` beside its shop day `announcedLocalDate` (T5 — the
 * boundary derives the day once, in the shop's zone), the window is
 * `windowFrom`/`windowUntil`, ids are brands.
 */

/** The announcement as the boundary stores it: the instant and its Sofia day. */
function announced(
  iso: string,
): Pick<Season, 'announcedAtUtcMs' | 'announcedLocalDate'> {
  const announcedAtUtcMs = utcMs(iso);
  return {
    announcedAtUtcMs,
    announcedLocalDate: ZonedTimeSystem.toLocal(
      announcedAtUtcMs,
      FIXTURE_TIME_ZONE,
    ).localDate,
  };
}

const autumn: Season = {
  id: SeasonId.of('season-2026-autumn'),
  seasonKind: SeasonKind.Season,
  title: { bg: 'Есен 2026', en: 'Autumn 2026' },
  emblem: BadgeEmblem.Autumn,
  windowFrom: localDate('2026-09-01'),
  windowUntil: localDate('2026-11-30'),
  trackSeriesId: BadgeSeriesId.of('series-2026-autumn-track'),
  seriesIds: [
    BadgeSeriesId.of('series-2026-autumn-each-month'),
    BadgeSeriesId.of('series-2026-autumn-beard'),
  ],
  ...announced('2026-08-01T06:00:00.000Z'),
  version: 1,
};

const beardWeek: Season = {
  ...autumn,
  id: SeasonId.of('event-2026-beard-week'),
  seasonKind: SeasonKind.Event,
  title: { bg: 'Седмица на брадата', en: 'Beard week' },
  emblem: BadgeEmblem.Event,
  windowFrom: localDate('2026-09-22'),
  windowUntil: localDate('2026-10-05'),
  trackSeriesId: null,
  seriesIds: [BadgeSeriesId.of('series-2026-beard-week-beard')],
  ...announced('2026-08-22T06:00:00.000Z'),
};

describe('SeasonSystem.phaseOn', () => {
  const season = autumn;

  it.each([
    ['2026-08-31', SeasonPhase.Announced],
    ['2026-09-01', SeasonPhase.Open],
    ['2026-10-15', SeasonPhase.Open],
    ['2026-11-30', SeasonPhase.Open],
    ['2026-12-01', SeasonPhase.Ended],
  ] as const)('on %s is %s (both ends inclusive)', (today, phase) => {
    expect(SeasonSystem.phaseOn(season, localDate(today))).toBe(phase);
  });
});

describe('SeasonSystem.familyIds', () => {
  it('lists the track first, then the season’s own families', () => {
    expect(SeasonSystem.familyIds(autumn)).toEqual([
      'series-2026-autumn-track',
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
  });

  it('is an event’s families alone', () => {
    expect(SeasonSystem.familyIds(beardWeek)).toEqual([
      'series-2026-beard-week-beard',
    ]);
  });
});

describe('SeasonSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const season = deepFreeze({
      ...autumn,
      ...announced('2026-08-02T21:30:00.000Z'),
      trackSeriesId: null,
    });
    const today: LocalDate = localDate('2026-10-15');
    const once = [
      SeasonSystem.phaseOn(season, today),
      SeasonSystem.familyIds(season),
    ];
    const twice = [
      SeasonSystem.phaseOn(season, today),
      SeasonSystem.familyIds(season),
    ];
    expect(twice).toEqual(once);
  });
});

// ── The archive and a season's track (Law 10.2, the decision pass) ──────

describe('SeasonSystem.byClosingYear', () => {
  const closing = (id: string, until: string) => ({
    id,
    windowUntil: localDate(until),
  });

  it('files the windows by the year each closed, newest year first, each year as they came', () => {
    const groups = SeasonSystem.byClosingYear([
      closing('season-2026-autumn', '2026-11-30'),
      closing('season-2026-winter', '2027-02-28'),
      closing('event-2026-beard-week', '2026-10-05'),
      closing('season-2025-summer', '2025-08-31'),
    ]);
    expect(
      groups.map((g) => [g.year, g.seasons.map((season) => season.id)]),
    ).toEqual([
      [2027, ['season-2026-winter']],
      [2026, ['season-2026-autumn', 'event-2026-beard-week']],
      [2025, ['season-2025-summer']],
    ]);
  });

  it('is nothing for no window', () => {
    expect(SeasonSystem.byClosingYear([])).toEqual([]);
  });
});

describe('SeasonSystem.trackOutlook', () => {
  const catalog = unwrapOk(
    LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
  );
  const track = (id: string): BadgeSeries => {
    const found = LoyaltyCatalogSystem.series(catalog, BadgeSeriesId.of(id));
    if (found === null) throw new Error(`no family ${id}`);
    return found;
  };
  const AUTUMN = track('series-2026-autumn-track');
  const SUMMER = track('series-2026-summer-track');
  const holder = (who: 'georgi' | 'martin') =>
    who === 'georgi'
      ? loyaltyAccountFixtures.georgi
      : loyaltyAccountFixtures.martin;
  const progressOf = (
    who: 'georgi' | 'martin',
    id: string,
  ): BadgeProgress | null =>
    holder(who).badgeProgress.find((p) => p.id === id) ?? null;
  const seasonProgressOf = (who: 'georgi' | 'martin', id: string) =>
    holder(who).seasonProgress.find((p) => p.id === id) ?? null;
  const outlook = (
    who: 'georgi' | 'martin',
    series: BadgeSeries,
    seasonId: string,
    pending: boolean,
    progress = progressOf(who, series.id),
  ) => {
    const season = seasonProgressOf(who, seasonId);
    const window = LoyaltyCatalogSystem.season(catalog, SeasonId.of(seasonId));
    if (window === null) throw new Error(`no season ${seasonId}`);
    return SeasonSystem.trackOutlook(
      series,
      BadgeSystem.standing(series, progress),
      season?.trackValue ?? null,
      season?.trackLevel ?? null,
      SeasonSystem.phaseOn(window, FIXTURE_TODAY),
      pending,
    );
  };
  const levelsOf = (o: { readonly levels: readonly { level: number }[] }) =>
    o.levels.map((l) => l.level);

  it('says the level won, then the way on: Георги at II of the autumn, one visit from III', () => {
    const o = outlook('georgi', AUTUMN, 'season-2026-autumn', false);
    expect(o).toMatchObject({
      seasonTrackState: SeasonTrackState.ToNext,
      max: 5,
      drawn: 2,
      remaining: 1,
      finished: false,
      level: 2,
      fromLevel: true,
    });
    expect(levelsOf(o)).toEqual([1, 2, 3, 4, 5]);
  });

  it('says the way on alone where nothing was won yet: Мартин, one visit from I', () => {
    expect(
      outlook('martin', AUTUMN, 'season-2026-autumn', false),
    ).toMatchObject({
      seasonTrackState: SeasonTrackState.ToNext,
      drawn: 0,
      remaining: 1,
      level: 0,
      fromLevel: false,
    });
  });

  it('stands at the next threshold when the visit on screen completes it, and opens on no level won', () => {
    expect(outlook('georgi', AUTUMN, 'season-2026-autumn', true)).toMatchObject(
      {
        seasonTrackState: SeasonTrackState.Pending,
        drawn: 3,
        finished: false,
        fromLevel: false,
      },
    );
    expect(outlook('martin', AUTUMN, 'season-2026-autumn', true)).toMatchObject(
      {
        seasonTrackState: SeasonTrackState.Pending,
        drawn: 1,
        fromLevel: false,
      },
    );
  });

  it('says a finished track is finished: no next threshold, whatever the visit', () => {
    const top: BadgeProgress = {
      id: AUTUMN.id,
      value: 5,
      earned: [1, 2, 3, 4, 5].map((level) => ({
        level,
        earnedAtUtcMs: utcMs('2026-09-28T08:00:00.000Z'),
        earnedLocalDate: localDate('2026-09-28'),
        earnedVia: EarnedVia.Rule,
        count: 1,
      })),
    };
    for (const pending of [false, true]) {
      expect(
        outlook('georgi', AUTUMN, 'season-2026-autumn', pending, top),
      ).toMatchObject({
        seasonTrackState: SeasonTrackState.Complete,
        // The season's own count (2) is the gauge's, as the card reads it.
        drawn: 2,
        remaining: 0,
        finished: false,
        fromLevel: false,
      });
    }
  });

  it('keeps an ended season’s levels reached, its gauge at the top, and nothing pending', () => {
    for (const pending of [false, true]) {
      const o = outlook('georgi', SUMMER, 'season-2026-summer', pending);
      expect(o).toMatchObject({
        seasonTrackState: SeasonTrackState.Ended,
        max: 3,
        drawn: 3,
        finished: true,
        level: 3,
        fromLevel: false,
      });
      expect(levelsOf(o)).toEqual([1, 2, 3]);
    }
  });

  it('draws no step for an ended season nothing was won in: the gauge tops at one', () => {
    const o = outlook('martin', SUMMER, 'season-2026-summer', false, null);
    expect(o.levels).toEqual([]);
    expect(o).toMatchObject({
      seasonTrackState: SeasonTrackState.Ended,
      max: 1,
      drawn: 1,
      finished: true,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const series = deepFreeze(AUTUMN);
    const standing = deepFreeze(
      BadgeSystem.standing(series, progressOf('georgi', series.id)),
    );
    const run = () =>
      SeasonSystem.trackOutlook(series, standing, 2, 2, SeasonPhase.Open, true);
    expect(run()).toEqual(run());
  });
});
