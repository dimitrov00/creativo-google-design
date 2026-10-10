import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { Gamification } from '../components/gamification.data';
import { SeriesId } from '../entities/badge-series.entity';
import { SeasonId, type SeasonEntity } from '../entities/season.entity';
import { deepFreeze } from '../testing';
import { SeasonSystem } from './season.system';

/*
 * The cases of libs/domain/engagement/src/lib/loyalty/season.spec.ts,
 * COPIED (the legacy spec keeps running against `Season`'s shim) and
 * re-targeted to the plain `SeasonEntity`: `announcedAt` is
 * `announcedAtMs`, ids are brands, and `Season.create`'s window, notice
 * and track rules are `SeasonSystem.validate`. Not copied: `an empty family
 * id` — a blank id is refused by the edge guard before `SeriesId.of`, not
 * by the season's rules.
 */

const SEASON_NOTICE_DAYS = Gamification.SEASON_NOTICE_DAYS;
const ZONE = 'Europe/Sofia';

const autumn: SeasonEntity = {
  id: SeasonId.of('season-2026-autumn'),
  kind: 'season',
  title: { bg: 'Есен 2026', en: 'Autumn 2026' },
  emblem: 'autumn',
  window: { from: DayKey.of('2026-09-01'), until: DayKey.of('2026-11-30') },
  trackSeriesId: SeriesId.of('series-2026-autumn-track'),
  seriesIds: [
    SeriesId.of('series-2026-autumn-each-month'),
    SeriesId.of('series-2026-autumn-beard'),
  ],
  announcedAtMs: Date.parse('2026-08-01T06:00:00.000Z'),
  version: 1,
};

const beardWeek: SeasonEntity = {
  ...autumn,
  id: SeasonId.of('event-2026-beard-week'),
  kind: 'event',
  title: { bg: 'Седмица на брадата', en: 'Beard week' },
  emblem: 'event',
  window: { from: DayKey.of('2026-09-22'), until: DayKey.of('2026-10-05') },
  trackSeriesId: null,
  seriesIds: [SeriesId.of('series-2026-beard-week-beard')],
  announcedAtMs: Date.parse('2026-08-22T06:00:00.000Z'),
};

function build(season: SeasonEntity): SeasonEntity {
  const result = SeasonSystem.validate(season, ZONE);
  if (!result.ok) {
    throw new Error(result.error.map((e) => e.code).join(', '));
  }
  return result.value;
}

function codes(season: SeasonEntity): string[] {
  const result = SeasonSystem.validate(season, ZONE);
  return result.ok ? [] : result.error.map((e) => e.code).sort();
}

const window = (from: string, until: string) => ({
  from: DayKey.of(from),
  until: DayKey.of(until),
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
    expect(season.window).toEqual({ from: '2026-09-01', until: '2026-11-30' });
    expect(season.title.bg).toBe('Есен 2026');
  });

  it('makes an event without a track', () => {
    const event = build(beardWeek);
    expect(event.kind).toBe('event');
    expect(event.trackSeriesId).toBeNull();
  });

  it('takes a one-day window', () => {
    expect(
      build({
        ...beardWeek,
        window: window('2026-09-22', '2026-09-22'),
      }).window.until,
    ).toBe('2026-09-22');
  });

  it.each<[string, Partial<SeasonEntity>, string[]]>([
    [
      'a window that ends before it starts',
      { window: window('2026-11-30', '2026-09-01') },
      ['engagement.season.window_inverted'],
    ],
    [
      'a window that is not two days',
      { window: window('2026-09-31', '2026-11-30') },
      ['engagement.season.window_malformed'],
    ],
    [
      'a season without a track',
      { trackSeriesId: null },
      ['engagement.season.without_track'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...autumn, ...override })).toEqual(expected);
  });

  it('refuses an event with a track', () => {
    expect(
      codes({
        ...beardWeek,
        trackSeriesId: SeriesId.of('series-2026-autumn-track'),
      }),
    ).toEqual(['engagement.season.event_with_track']);
  });

  describe('the notice period (R29)', () => {
    it(`asks for ${SEASON_NOTICE_DAYS} days between the announcement and the first day`, () => {
      expect(
        codes({
          ...autumn,
          announcedAtMs: Date.parse('2026-08-02T06:00:00.000Z'),
        }),
      ).toEqual([]);
      expect(
        codes({
          ...autumn,
          announcedAtMs: Date.parse('2026-08-03T06:00:00.000Z'),
        }),
      ).toEqual(['engagement.season.announced_late']);
    });

    // 21:30 UTC on 2 August is already 3 August in Sofia: one day too late.
    it('counts the announcement on the Sofia calendar', () => {
      expect(
        codes({
          ...autumn,
          announcedAtMs: Date.parse('2026-08-02T21:30:00.000Z'),
        }),
      ).toEqual(['engagement.season.announced_late']);
    });

    it('names the day it was announced, the first day and the notice', () => {
      const result = SeasonSystem.validate(
        { ...autumn, announcedAtMs: Date.parse('2026-08-02T21:30:00.000Z') },
        ZONE,
      );
      expect(!result.ok && result.error).toEqual([
        {
          code: 'engagement.season.announced_late',
          announcedOn: '2026-08-03',
          from: '2026-09-01',
          noticeDays: 30,
        },
      ]);
    });

    it('cannot read the notice in a zone nobody knows, and refuses nothing for it', () => {
      expect(SeasonSystem.validate(autumn, 'Not/AZone').ok).toBe(true);
    });
  });
});

describe('SeasonSystem.phaseOn', () => {
  const season = build(autumn);

  it.each([
    ['2026-08-31', 'announced'],
    ['2026-09-01', 'open'],
    ['2026-10-15', 'open'],
    ['2026-11-30', 'open'],
    ['2026-12-01', 'ended'],
  ] as const)('on %s is %s (both ends inclusive)', (today, phase) => {
    expect(SeasonSystem.phaseOn(season.window, DayKey.of(today))).toBe(phase);
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
      announcedAtMs: Date.parse('2026-08-02T21:30:00.000Z'),
      trackSeriesId: null,
    });
    const today = DayKey.of('2026-10-15');
    const once = [
      SeasonSystem.validate(season, ZONE),
      SeasonSystem.phaseOn(season.window, today),
      SeasonSystem.familyIds(season),
    ];
    const twice = [
      SeasonSystem.validate(season, ZONE),
      SeasonSystem.phaseOn(season.window, today),
      SeasonSystem.familyIds(season),
    ];
    expect(twice).toEqual(once);
  });
});
