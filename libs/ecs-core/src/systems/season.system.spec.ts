import { describe, expect, it } from 'vitest';
import {
  BadgeEmblem,
  Gamification,
  SeasonKind,
  SeasonPhase,
} from '@core/components';
import type { Season } from '@core/entities';
import { BadgeSeriesId, SeasonId, type LocalDate } from '@core/primitives';
import { FIXTURE_TIME_ZONE, deepFreeze, localDate, utcMs } from '@core/testing';
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
