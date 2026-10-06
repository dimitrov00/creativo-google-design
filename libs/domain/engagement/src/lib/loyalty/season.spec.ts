import { describe, expect, it } from 'vitest';
import { SEASON_NOTICE_DAYS, Season, SeasonProps } from './season';

const autumn: SeasonProps = {
  id: 'season-2026-autumn',
  kind: 'season',
  title: { bg: 'Есен 2026', en: 'Autumn 2026' },
  emblem: 'autumn',
  window: { from: '2026-09-01', until: '2026-11-30' },
  trackSeriesId: 'series-2026-autumn-track',
  seriesIds: ['series-2026-autumn-each-month', 'series-2026-autumn-beard'],
  announcedAt: new Date('2026-08-01T06:00:00.000Z'),
  version: 1,
};

const beardWeek: SeasonProps = {
  ...autumn,
  id: 'event-2026-beard-week',
  kind: 'event',
  title: { bg: 'Седмица на брадата', en: 'Beard week' },
  emblem: 'event',
  window: { from: '2026-09-22', until: '2026-10-05' },
  trackSeriesId: null,
  seriesIds: ['series-2026-beard-week-beard'],
  announcedAt: new Date('2026-08-22T06:00:00.000Z'),
};

function build(props: SeasonProps): Season {
  const result = Season.create(props);
  if (result.isFailure()) {
    throw new Error(result.error.map((e) => e.code).join(', '));
  }
  return result.value;
}

function codes(props: SeasonProps): string[] {
  const result = Season.create(props);
  return result.isFailure() ? result.error.map((e) => e.code).sort() : [];
}

describe('Season.create', () => {
  it('makes a season with its track and its families, typed', () => {
    const season = build(autumn);
    expect(season.id.value).toBe('season-2026-autumn');
    expect(season.trackSeriesId?.value).toBe('series-2026-autumn-track');
    expect(season.seriesIds.map((id) => id.value)).toEqual([
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
    expect(season.window).toEqual({ from: '2026-09-01', until: '2026-11-30' });
    expect(season.title.get('bg')).toBe('Есен 2026');
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
        window: { from: '2026-09-22', until: '2026-09-22' },
      }).window.until,
    ).toBe('2026-09-22');
  });

  it.each<[string, Partial<SeasonProps>, string[]]>([
    [
      'a window that ends before it starts',
      { window: { from: '2026-11-30', until: '2026-09-01' } },
      ['engagement.season.window_inverted'],
    ],
    [
      'a window that is not two days',
      { window: { from: '2026-09-31', until: '2026-11-30' } },
      ['engagement.season.window_malformed'],
    ],
    [
      'a season without a track',
      { trackSeriesId: null },
      ['engagement.season.without_track'],
    ],
    [
      'an empty family id',
      { seriesIds: ['series-2026-autumn-beard', ''] },
      ['engagement.id.empty'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...autumn, ...override })).toEqual(expected);
  });

  it('refuses an event with a track', () => {
    expect(
      codes({ ...beardWeek, trackSeriesId: 'series-2026-autumn-track' }),
    ).toEqual(['engagement.season.event_with_track']);
  });

  describe('the notice period (R29)', () => {
    it(`asks for ${SEASON_NOTICE_DAYS} days between the announcement and the first day`, () => {
      expect(
        codes({ ...autumn, announcedAt: new Date('2026-08-02T06:00:00.000Z') }),
      ).toEqual([]);
      expect(
        codes({ ...autumn, announcedAt: new Date('2026-08-03T06:00:00.000Z') }),
      ).toEqual(['engagement.season.announced_late']);
    });

    // 21:30 UTC on 2 August is already 3 August in Sofia: one day too late.
    it('counts the announcement on the Sofia calendar', () => {
      expect(
        codes({ ...autumn, announcedAt: new Date('2026-08-02T21:30:00.000Z') }),
      ).toEqual(['engagement.season.announced_late']);
    });
  });
});

describe('Season.phaseOn', () => {
  const season = build(autumn);

  it.each([
    ['2026-08-31', 'announced'],
    ['2026-09-01', 'open'],
    ['2026-10-15', 'open'],
    ['2026-11-30', 'open'],
    ['2026-12-01', 'ended'],
  ] as const)('on %s is %s (both ends inclusive)', (today, phase) => {
    expect(season.phaseOn(today)).toBe(phase);
  });
});

describe('Season.familyIds', () => {
  it('lists the track first, then the season’s own families', () => {
    expect(
      build(autumn)
        .familyIds()
        .map((id) => id.value),
    ).toEqual([
      'series-2026-autumn-track',
      'series-2026-autumn-each-month',
      'series-2026-autumn-beard',
    ]);
  });

  it('is an event’s families alone', () => {
    expect(
      build(beardWeek)
        .familyIds()
        .map((id) => id.value),
    ).toEqual(['series-2026-beard-week-beard']);
  });
});
