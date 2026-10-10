import { describe, expect, it } from 'vitest';
import { Weekday } from './weekday.data';

describe('Weekday', () => {
  it('is ISO-numbered, Monday first', () => {
    expect([
      Weekday.Mon,
      Weekday.Tue,
      Weekday.Wed,
      Weekday.Thu,
      Weekday.Fri,
      Weekday.Sat,
      Weekday.Sun,
    ]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('isWeekend is Saturday and Sunday', () => {
    expect(Weekday.isWeekend(Weekday.Sat)).toBe(true);
    expect(Weekday.isWeekend(Weekday.Sun)).toBe(true);
    expect(Weekday.isWeekend(Weekday.Fri)).toBe(false);
    expect(Weekday.isWeekend(Weekday.Mon)).toBe(false);
  });

  it('ofEpochDay: 1970-01-01 was a Thursday, and it works before the epoch too', () => {
    expect(Weekday.ofEpochDay(0)).toBe(Weekday.Thu);
    expect(Weekday.ofEpochDay(4)).toBe(Weekday.Mon);
    expect(Weekday.ofEpochDay(-1)).toBe(Weekday.Wed);
    expect(Weekday.ofEpochDay(-4)).toBe(Weekday.Sun);
    // 2026-03-29 (epoch day 20541) is the Sunday Sofia springs forward.
    expect(Weekday.ofEpochDay(20_541)).toBe(Weekday.Sun);
  });
});
