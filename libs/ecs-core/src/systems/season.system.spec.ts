import { describe, expect, it } from 'vitest';
import {
  BadgeEmblem,
  EarnedVia,
  Gamification,
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
import { type SeasonShapeInput, SeasonSystem } from './season.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of the legacy engagement `season.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED while it
 * still ran against `Season`'s shim, and re-targeted to the flat `Season`: the
 * announcement is `announcedAtUtcMs` beside its shop day `announcedLocalDate`
 * (T5 — the boundary derives the day once, in the shop's zone), the window is
 * `windowFrom`/`windowUntil`, ids are brands, and `Season.create`'s window,
 * notice and track rules are `SeasonSystem.validate`. Not copied: `an empty
 * family id` — a blank id is refused by the edge guard before
 * `BadgeSeriesId.of`, not by the season's rules.
 */

const SEASON_NOTICE_DAYS = Gamification.SEASON_NOTICE_DAYS;

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

function build<S extends SeasonShapeInput>(season: S): S {
  const result = SeasonSystem.validate(season);
  if (!result.ok) {
    throw new Error(result.error.map((e) => e.errorCode).join(', '));
  }
  return result.value;
}

function codes(season: SeasonShapeInput): string[] {
  const result = SeasonSystem.validate(season);
  return result.ok ? [] : result.error.map((e) => e.errorCode).sort();
}

/** A window as an author typed it — foreign input the rule proves real. */
const window = (from: string, until: string) => ({
  windowFrom: from,
  windowUntil: until,
});

describe('SeasonSystem.validate', () => {
  it('makes a season with its track and its families, typed', () => {
    const season = build(autumn);
    expect(season.id).toBe('season-2026-autumn');
    expect(season.trackSeriesId).toBe('series-2026-autumn-track');
    expect(season.seriesIds).toEqual([
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
    expect({
      windowFrom: season.windowFrom,
      windowUntil: season.windowUntil,
    }).toEqual({ windowFrom: '2026-09-01', windowUntil: '2026-11-30' });
    expect(season.title.bg).toBe('Есен 2026');
  });

  it('makes an event without a track', () => {
    const event = build(beardWeek);
    expect(event.seasonKind).toBe('EVENT');
    expect(event.trackSeriesId).toBeNull();
  });

  it('takes a one-day window', () => {
    expect(
      build({
        ...beardWeek,
        ...window('2026-09-22', '2026-09-22'),
      }).windowUntil,
    ).toBe('2026-09-22');
  });

  it.each<[string, Partial<SeasonShapeInput>, string[]]>([
    [
      'a window that ends before it starts',
      window('2026-11-30', '2026-09-01'),
      ['ENGAGEMENT_SEASON_WINDOW_INVERTED'],
    ],
    [
      'a window that is not two days',
      window('2026-09-31', '2026-11-30'),
      ['ENGAGEMENT_SEASON_WINDOW_MALFORMED'],
    ],
    [
      'a season without a track',
      { trackSeriesId: null },
      ['ENGAGEMENT_SEASON_WITHOUT_TRACK'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...autumn, ...override })).toEqual(expected);
  });

  it('refuses an event with a track', () => {
    expect(
      codes({
        ...beardWeek,
        trackSeriesId: BadgeSeriesId.of('series-2026-autumn-track'),
      }),
    ).toEqual(['ENGAGEMENT_SEASON_EVENT_WITH_TRACK']);
  });

  describe('the notice period (R29)', () => {
    it(`asks for ${SEASON_NOTICE_DAYS} days between the announcement and the first day`, () => {
      expect(
        codes({ ...autumn, ...announced('2026-08-02T06:00:00.000Z') }),
      ).toEqual([]);
      expect(
        codes({ ...autumn, ...announced('2026-08-03T06:00:00.000Z') }),
      ).toEqual(['ENGAGEMENT_SEASON_ANNOUNCED_LATE']);
    });

    // 21:30 UTC on 2 August is already 3 August in Sofia: one day too late.
    it('counts the announcement on the Sofia calendar', () => {
      const late = announced('2026-08-02T21:30:00.000Z');
      expect(late.announcedLocalDate).toBe('2026-08-03');
      expect(codes({ ...autumn, ...late })).toEqual([
        'ENGAGEMENT_SEASON_ANNOUNCED_LATE',
      ]);
    });

    it('names the day it was announced, the first day and the notice', () => {
      const result = SeasonSystem.validate({
        ...autumn,
        ...announced('2026-08-02T21:30:00.000Z'),
      });
      expect(!result.ok && result.error).toEqual([
        {
          errorCode: 'ENGAGEMENT_SEASON_ANNOUNCED_LATE',
          announcedOn: '2026-08-03',
          from: '2026-09-01',
          noticeDays: 30,
        },
      ]);
    });

    it('reads no zone: the notice is judged on the stored shop day alone', () => {
      // Today's "a zone nobody knows refuses nothing": no zone reaches the
      // system any more — the boundary hands the day (T5).
      expect(SeasonSystem.validate(autumn).ok).toBe(true);
      expect(
        SeasonSystem.validate({
          ...autumn,
          announcedLocalDate: localDate('2026-08-03'),
        }).ok,
      ).toBe(false);
    });
  });
});

describe('SeasonSystem.phaseOn', () => {
  const season = build(autumn);

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
    expect(SeasonSystem.familyIds(build(autumn))).toEqual([
      'series-2026-autumn-track',
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
  });

  it('is an event’s families alone', () => {
    expect(SeasonSystem.familyIds(build(beardWeek))).toEqual([
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
      SeasonSystem.validate(season),
      SeasonSystem.phaseOn(season, today),
      SeasonSystem.familyIds(season),
    ];
    const twice = [
      SeasonSystem.validate(season),
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
