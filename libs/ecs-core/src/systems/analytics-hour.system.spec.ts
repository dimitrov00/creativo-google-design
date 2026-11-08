import { describe, expect, it } from 'vitest';
import { MinuteRange } from '@core/components';
import { type LocalDate, type MinuteCount, Weekday } from '@core/primitives';
import { deepFreeze, endMinute, localDate, minute } from '@core/testing';
import {
  AnalyticsHourSystem,
  type HourCell,
  type HourDay,
} from './analytics-hour.system';

const H = AnalyticsHourSystem;
const range = (start: number, end: number): MinuteRange =>
  MinuteRange.of(minute(start), endMinute(end));
/** Monday 12 October 2026 and the days after it. */
const MONDAY = localDate('2026-10-12');
const TUESDAY = localDate('2026-10-13');
const NEXT_MONDAY = localDate('2026-10-19');

/** The buckets that are not zero, as `{ hour: minutes }`. */
function nonZero(buckets: readonly MinuteCount[]): Record<number, number> {
  return Object.fromEntries(
    buckets
      .map((value, hour) => [hour, value as number] as const)
      .filter(([, value]) => value !== 0),
  );
}

const cell = (
  weekday: Weekday,
  hour: number,
  worked: number,
  rostered: number,
): HourCell =>
  ({
    weekday,
    hour,
    workedMinutes: worked,
    rosteredMinutes: rostered,
  }) as HourCell;

describe('AnalyticsHourSystem.bucketsOf — one day in 24 buckets', () => {
  it('splits a stretch crossing hour marks into the minutes of each hour', () => {
    // 09:30–12:15: 30 in hour 9, 60 in 10 and 11, 15 in 12.
    const day = H.bucketsOf(MONDAY, [], [range(570, 735)]);
    expect(day.localDate).toBe(MONDAY);
    expect(day.rostered).toHaveLength(24);
    expect(day.worked).toHaveLength(24);
    expect(nonZero(day.rostered)).toEqual({ 9: 30, 10: 60, 11: 60, 12: 15 });
    expect(nonZero(day.worked)).toEqual({});
  });

  it('unions overlapping stretches, and a stretch to midnight fills hour 23', () => {
    const day = H.bucketsOf(
      MONDAY,
      [],
      [range(600, 700), range(660, 720), range(1380, 1440)],
    );
    expect(nonZero(day.rostered)).toEqual({ 10: 60, 11: 60, 23: 60 });
  });

  it('counts a seat only inside its stretch — the minutes outside are never a part', () => {
    // Rostered 09:00–12:00; a seat 11:30–12:45 counts its 30 rostered minutes.
    const day = H.bucketsOf(MONDAY, [range(690, 765)], [range(540, 720)]);
    expect(nonZero(day.worked)).toEqual({ 11: 30 });
    expect(nonZero(day.rostered)).toEqual({ 9: 60, 10: 60, 11: 60 });
  });

  it('does not count two seats’ shared minutes twice', () => {
    const day = H.bucketsOf(
      MONDAY,
      [range(600, 645), range(630, 660)],
      [range(540, 1080)],
    );
    expect(nonZero(day.worked)).toEqual({ 10: 60 });
  });

  it('rosters nothing on a day without stretches, whatever the seats', () => {
    const day = H.bucketsOf(MONDAY, [range(600, 660)], []);
    expect(nonZero(day.worked)).toEqual({});
    expect(nonZero(day.rostered)).toEqual({});
  });
});

describe('AnalyticsHourSystem.grid — weekday × hour', () => {
  const monday = H.bucketsOf(MONDAY, [range(600, 630)], [range(540, 720)]);
  const nextMonday = H.bucketsOf(
    NEXT_MONDAY,
    [range(600, 660), range(690, 720)],
    [range(540, 720)],
  );
  const tuesday = H.bucketsOf(TUESDAY, [], [range(600, 660)]);

  it('sums the days of one weekday into its cells, in weekday-then-hour order, listing only cells with minutes', () => {
    expect(H.grid([tuesday, nextMonday, monday])).toEqual([
      cell(Weekday.Mon, 9, 0, 120),
      cell(Weekday.Mon, 10, 90, 120),
      cell(Weekday.Mon, 11, 30, 120),
      cell(Weekday.Tue, 10, 0, 60),
    ]);
  });

  it('is empty for no days, and never longer than 168 cells', () => {
    expect(H.grid([])).toEqual([]);
    const full: HourDay[] = [];
    for (let d = 0; d < 14; d++) {
      full.push(
        H.bucketsOf(
          localDate(`2026-10-${String(12 + d).padStart(2, '0')}`),
          [],
          [range(0, 1440)],
        ),
      );
    }
    const grid = H.grid(full);
    expect(grid).toHaveLength(168);
    expect(grid.every((c) => c.rosteredMinutes === 120)).toBe(true);
  });
});

describe('AnalyticsHourSystem.peak — the busiest and the emptiest hour', () => {
  const cells = [
    cell(Weekday.Mon, 9, 30, 60), // 0.5
    cell(Weekday.Mon, 10, 60, 60), // 1
    cell(Weekday.Tue, 9, 0, 60), // 0
    cell(Weekday.Tue, 10, 120, 120), // 1 — ties Mon 10
    cell(Weekday.Wed, 9, 0, 120), // 0 — ties Tue 9
    cell(Weekday.Wed, 10, 90, 0), // no rostered minutes: out
  ];

  it('names the highest and the lowest worked ÷ rostered among rostered cells, the earliest on a tie', () => {
    expect(H.peak(cells, 7)).toEqual({
      busiest: { weekday: Weekday.Mon, hour: 10 },
      emptiest: { weekday: Weekday.Tue, hour: 9 },
    });
  });

  it('ties exactly on equal fractions, not on floating-point drift', () => {
    expect(
      H.peak(
        [
          cell(Weekday.Tue, 9, 2, 3),
          cell(Weekday.Mon, 9, 4, 6),
          cell(Weekday.Wed, 9, 1, 3),
        ],
        7,
      ),
    ).toEqual({
      busiest: { weekday: Weekday.Mon, hour: 9 },
      emptiest: { weekday: Weekday.Wed, hour: 9 },
    });
  });

  it('names nothing under 7 rostered days, or with no rostered cell', () => {
    expect(H.peak(cells, 6)).toEqual({ busiest: null, emptiest: null });
    expect(H.peak([cell(Weekday.Mon, 9, 30, 0)], 7)).toEqual({
      busiest: null,
      emptiest: null,
    });
    expect(H.peak([], 7)).toEqual({ busiest: null, emptiest: null });
  });

  it('a single rostered cell is both the busiest and the emptiest', () => {
    expect(H.peak([cell(Weekday.Fri, 15, 10, 60)], 7)).toEqual({
      busiest: { weekday: Weekday.Fri, hour: 15 },
      emptiest: { weekday: Weekday.Fri, hour: 15 },
    });
  });
});

describe('AnalyticsHourSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const seats = deepFreeze([range(600, 645), range(630, 660)]);
    const stretches = deepFreeze([range(540, 720), range(780, 1080)]);
    const dates: readonly LocalDate[] = deepFreeze([MONDAY, TUESDAY]);
    const once = H.bucketsOf(dates[0] as LocalDate, seats, stretches);
    const twice = H.bucketsOf(dates[0] as LocalDate, seats, stretches);
    expect(twice).toEqual(once);
    const days = deepFreeze([once, H.bucketsOf(TUESDAY, seats, stretches)]);
    const grid = deepFreeze(H.grid(days));
    expect(H.grid(days)).toEqual(grid);
    expect(H.peak(grid, 7)).toEqual(H.peak(grid, 7));
    expect(seats).toEqual([range(600, 645), range(630, 660)]);
    expect(stretches).toEqual([range(540, 720), range(780, 1080)]);
  });
});
