import { describe, expect, it } from 'vitest';
import { LocalDate } from './local-date.primitive';
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

  it('the weekday of an epoch day (LocalDate.weekday): 1970-01-01 was a Thursday, and it works before the epoch too', () => {
    const of = (epochDay: number): Weekday =>
      LocalDate.weekday(LocalDate.fromEpochDay(epochDay));
    expect(of(0)).toBe(Weekday.Thu);
    expect(of(4)).toBe(Weekday.Mon);
    expect(of(-1)).toBe(Weekday.Wed);
    expect(of(-4)).toBe(Weekday.Sun);
    // 2026-03-29 (epoch day 20541) is the Sunday Sofia springs forward.
    expect(of(20_541)).toBe(Weekday.Sun);
  });
});
