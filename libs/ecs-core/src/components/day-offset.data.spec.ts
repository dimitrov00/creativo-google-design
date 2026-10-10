import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import { DayOffset } from './day-offset.data';
import { Weekday } from './weekday.data';

/*
 * Literal Europe/Sofia rows (the shape `ZonedTimeSystem.dayTable` builds):
 * an ordinary Saturday, the 23-hour Sunday the clocks spring forward on,
 * and the Monday after.
 */
const HOUR = 3_600_000;
const SAT: DayOffset = {
  dayKey: DayKey.of('2026-03-28'),
  dayStartMs: 1_774_648_800_000, // 2026-03-27T22:00Z
  offsetMinutes: 120,
  transitionAtMinutes: null,
  transitionDeltaMinutes: 0,
  weekday: Weekday.Sat,
};
const SUN: DayOffset = {
  dayKey: DayKey.of('2026-03-29'),
  dayStartMs: 1_774_735_200_000, // 2026-03-28T22:00Z
  offsetMinutes: 120,
  transitionAtMinutes: 180,
  transitionDeltaMinutes: 60,
  weekday: Weekday.Sun,
};
const MON: DayOffset = {
  dayKey: DayKey.of('2026-03-30'),
  dayStartMs: 1_774_818_000_000, // 2026-03-29T21:00Z
  offsetMinutes: 180,
  transitionAtMinutes: null,
  transitionDeltaMinutes: 0,
  weekday: Weekday.Mon,
};
const AUTUMN: DayOffset = {
  dayKey: DayKey.of('2026-10-25'),
  dayStartMs: 1_792_875_600_000, // 2026-10-24T21:00Z
  offsetMinutes: 180,
  transitionAtMinutes: 240,
  transitionDeltaMinutes: -60,
  weekday: Weekday.Sun,
};
const DAYS: readonly DayOffset[] = [SAT, SUN, MON];

describe('DayOffset — one row', () => {
  it('lengthMinutes is 24 h, or 23 h / 25 h on a DST day', () => {
    expect(DayOffset.lengthMinutes(SAT)).toBe(1440);
    expect(DayOffset.lengthMinutes(SUN)).toBe(1380);
    expect(DayOffset.lengthMinutes(AUTUMN)).toBe(1500);
  });

  it('endMs is the next day start', () => {
    expect(DayOffset.endMs(SAT)).toBe(SUN.dayStartMs);
    expect(DayOffset.endMs(SUN)).toBe(MON.dayStartMs);
    expect(DayOffset.endMs(AUTUMN)).toBe(AUTUMN.dayStartMs + 25 * HOUR);
  });

  it('isTransition marks the switch days only', () => {
    expect(DAYS.map(DayOffset.isTransition)).toEqual([false, true, false]);
    expect(DayOffset.isTransition(AUTUMN)).toBe(true);
  });
});

describe('DayOffset — binary search over a table', () => {
  it('indexOf / find / weekdayOf locate a day key', () => {
    expect(DayOffset.indexOf(DayKey.of('2026-03-28'), DAYS)).toBe(0);
    expect(DayOffset.indexOf(DayKey.of('2026-03-29'), DAYS)).toBe(1);
    expect(DayOffset.indexOf(DayKey.of('2026-03-30'), DAYS)).toBe(2);
    expect(DayOffset.find(DayKey.of('2026-03-29'), DAYS)).toBe(SUN);
    expect(DayOffset.weekdayOf(DayKey.of('2026-03-30'), DAYS)).toBe(
      Weekday.Mon,
    );
  });

  it('answers −1 / null for a day the table does not cover', () => {
    for (const raw of ['2026-03-27', '2026-03-31']) {
      expect(DayOffset.indexOf(DayKey.of(raw), DAYS)).toBe(-1);
      expect(DayOffset.find(DayKey.of(raw), DAYS)).toBeNull();
      expect(DayOffset.weekdayOf(DayKey.of(raw), DAYS)).toBeNull();
    }
    expect(DayOffset.indexOf(DayKey.of('2026-03-29'), [])).toBe(-1);
  });

  it('indexAt finds the day holding an instant, start inclusive, end exclusive', () => {
    expect(DayOffset.indexAt(SAT.dayStartMs, DAYS)).toBe(0);
    expect(DayOffset.indexAt(SUN.dayStartMs - 1, DAYS)).toBe(0);
    expect(DayOffset.indexAt(SUN.dayStartMs, DAYS)).toBe(1);
    expect(DayOffset.indexAt(MON.dayStartMs - 1, DAYS)).toBe(1);
    expect(DayOffset.indexAt(MON.dayStartMs + 12 * HOUR, DAYS)).toBe(2);
  });

  it('indexAt is −1 before the first row, after the last, and in a gap between rows', () => {
    expect(DayOffset.indexAt(SAT.dayStartMs - 1, DAYS)).toBe(-1);
    expect(DayOffset.indexAt(DayOffset.endMs(MON), DAYS)).toBe(-1);
    expect(DayOffset.indexAt(SUN.dayStartMs, [SAT, MON])).toBe(-1);
    expect(DayOffset.indexAt(SUN.dayStartMs, [])).toBe(-1);
  });
});
