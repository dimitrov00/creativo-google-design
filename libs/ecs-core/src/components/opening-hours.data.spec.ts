import { describe, expect, it } from 'vitest';
import { minute, until } from '@core/testing';
import {
  type ClockDayHours,
  DayHours,
  type DayHoursInput,
  OpeningState,
} from './opening-hours.data';
import { Weekday } from '@core/primitives';

const CLOSED = DayHours.closed();
const NINE_TO_SIX = DayHours.open(minute(540), until(18));

/** A raw open day in minutes — the week guard's input. */
const open = (openMinutes: number, closeMinutes: number): DayHoursInput => ({
  openingState: OpeningState.Open,
  openMinutes,
  closeMinutes,
});

function week(): DayHours[] {
  return [
    NINE_TO_SIX,
    NINE_TO_SIX,
    NINE_TO_SIX,
    NINE_TO_SIX,
    NINE_TO_SIX,
    DayHours.open(minute(600), until(18)),
    CLOSED,
  ];
}

/** The same week as raw input. */
function rawWeek(): DayHoursInput[] {
  return [...week()];
}

const clock = (opens: string, closes: string): ClockDayHours => ({
  openingState: OpeningState.Open,
  opens,
  closes,
});

function clockWeek(): ClockDayHours[] {
  return [
    clock('09:00', '18:00'),
    clock('09:00', '18:00'),
    clock('09:00', '18:00'),
    clock('09:00', '18:00'),
    clock('09:00', '18:00'),
    clock('10:00', '18:00'),
    { openingState: OpeningState.Closed },
  ];
}

describe('DayHours', () => {
  it('pins the opening tags', () => {
    expect(OpeningState).toEqual({ Closed: 'CLOSED', Open: 'OPEN' });
    expect(CLOSED).toEqual({ openingState: 'CLOSED' });
    expect(NINE_TO_SIX).toEqual({
      openingState: 'OPEN',
      openMinutes: 540,
      closeMinutes: 1080,
    });
  });

  it('forWeekday(): Monday first, index weekday − 1', () => {
    expect(DayHours.forWeekday(week(), Weekday.Mon)).toEqual(NINE_TO_SIX);
    expect(DayHours.forWeekday(week(), Weekday.Sat)).toEqual(
      DayHours.open(minute(600), until(18)),
    );
    expect(DayHours.forWeekday(week(), Weekday.Sun)).toEqual(CLOSED);
    expect(DayHours.forWeekday([], Weekday.Mon)).toBeNull();
  });
});

describe('DayHours.isOpenAt', () => {
  it('is open from the opening minute up to, not including, the closing minute', () => {
    expect(DayHours.isOpenAt(week(), Weekday.Mon, minute(539))).toBe(false);
    expect(DayHours.isOpenAt(week(), Weekday.Mon, minute(540))).toBe(true);
    expect(DayHours.isOpenAt(week(), Weekday.Mon, minute(1079))).toBe(true);
    expect(DayHours.isOpenAt(week(), Weekday.Mon, minute(1080))).toBe(false);
  });

  it('reads the right weekday', () => {
    expect(DayHours.isOpenAt(week(), Weekday.Fri, minute(570))).toBe(true);
    expect(DayHours.isOpenAt(week(), Weekday.Sat, minute(570))).toBe(false);
  });

  it('is never open on a closed or missing day', () => {
    expect(DayHours.isOpenAt(week(), Weekday.Sun, minute(720))).toBe(false);
    expect(DayHours.isOpenAt([NINE_TO_SIX], Weekday.Tue, minute(720))).toBe(
      false,
    );
  });
});

describe('DayHours.parseClock', () => {
  it('reads zero-padded HH:mm as minutes of the day', () => {
    expect(DayHours.parseClock('00:00')).toEqual({ ok: true, value: 0 });
    expect(DayHours.parseClock('09:30')).toEqual({ ok: true, value: 570 });
    expect(DayHours.parseClock('23:59')).toEqual({ ok: true, value: 1439 });
  });

  it('rejects anything else, carrying the text', () => {
    for (const raw of [
      '9:00',
      '24:00',
      '12:60',
      '',
      '12:00:00',
      ' 12:00',
      '1200',
    ]) {
      expect(DayHours.parseClock(raw)).toEqual({
        ok: false,
        error: {
          errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
          rawValue: raw,
        },
      });
    }
  });
});

describe('DayHours.parseWeek', () => {
  it('accepts seven Monday-first days, the closed day kept', () => {
    const result = DayHours.parseWeek(rawWeek());
    expect(result).toEqual({ ok: true, value: week() });
  });

  it('returns fresh structs holding only their own keys', () => {
    const stray = {
      openingState: 'OPEN',
      openMinutes: 540,
      closeMinutes: 1080,
      opens: '09:00',
    } as DayHoursInput;
    const raw = [stray, ...rawWeek().slice(1)];
    const result = DayHours.parseWeek(raw);
    expect(result.ok && result.value[0]).toEqual(NINE_TO_SIX);
    expect(result.ok && Object.keys(result.value[0] as DayHours)).toEqual([
      'openingState',
      'openMinutes',
      'closeMinutes',
    ]);
  });

  it('rejects a week that is not exactly 7 entries, alone', () => {
    expect(DayHours.parseWeek(rawWeek().slice(0, 6))).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_LENGTH', rawLength: 6 },
      ],
    });
  });

  it('rejects a figure that is not a minute of the day', () => {
    for (const bad of [-1, 1440, 570.5, Number.NaN]) {
      const raw = [open(bad, 1080), ...rawWeek().slice(1)];
      expect(DayHours.parseWeek(raw)).toEqual({
        ok: false,
        error: [
          {
            errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
            rawValue: String(bad),
          },
        ],
      });
    }
    const lateClose = [open(540, 1440), ...rawWeek().slice(1)];
    expect(DayHours.parseWeek(lateClose)).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY', rawValue: '1440' },
      ],
    });
  });

  it('rejects an open day where closing is not after opening, by day index', () => {
    const raw = rawWeek();
    raw[2] = open(1080, 1080);
    raw[4] = open(1080, 540);
    expect(DayHours.parseWeek(raw)).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_RANGE', dayIndex: 2 },
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_RANGE', dayIndex: 4 },
      ],
    });
  });
});

// catalog location.spec.ts hours cases, on the legacy clock-text shape.
describe('DayHours.parseClockWeek', () => {
  it('converts the stored HH:mm week to minutes', () => {
    expect(DayHours.parseClockWeek(clockWeek())).toEqual({
      ok: true,
      value: week(),
    });
  });

  it('converts the seed’s Center week (tools/seed/catalog.mjs)', () => {
    const result = DayHours.parseClockWeek([
      clock('09:00', '20:00'),
      clock('09:00', '20:00'),
      clock('09:00', '20:00'),
      clock('09:00', '20:00'),
      clock('09:00', '21:00'),
      clock('10:00', '18:00'),
      { openingState: OpeningState.Closed },
    ]);
    expect(result.ok && result.value[4]).toEqual(
      DayHours.open(minute(540), until(21)),
    );
    expect(result.ok && result.value[6]).toEqual(CLOSED);
  });

  it('rejects hours that are not exactly 7 entries', () => {
    expect(DayHours.parseClockWeek(clockWeek().slice(0, 6))).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_LENGTH', rawLength: 6 },
      ],
    });
  });

  it('rejects a malformed time-of-day string — the opening time first', () => {
    const raw = clockWeek();
    raw[0] = clock('9:00', '18:00');
    raw[1] = clock('09:00', '25:00');
    raw[2] = clock('nope', 'also nope');
    expect(DayHours.parseClockWeek(raw)).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY', rawValue: '9:00' },
        {
          errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY',
          rawValue: '25:00',
        },
        { errorCode: 'CATALOG_LOCATION_INVALID_TIME_OF_DAY', rawValue: 'nope' },
      ],
    });
  });

  it('rejects an open day where closes is not after opens', () => {
    const raw = clockWeek();
    raw[3] = clock('18:00', '09:00');
    expect(DayHours.parseClockWeek(raw)).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCATION_INVALID_HOURS_RANGE', dayIndex: 3 },
      ],
    });
  });
});
