import { describe, expect, it } from 'vitest';
import { HourOfDay } from './hour-of-day.data';
import { MinuteOfDay } from './minute-of-day.primitive';

describe('HourOfDay', () => {
  it('lists the 24 hours of a shop day in order', () => {
    expect(HourOfDay.ALL).toHaveLength(24);
    expect(HourOfDay.PER_DAY).toBe(24);
    expect(HourOfDay.ALL[0]).toBe(0);
    expect(HourOfDay.ALL[23]).toBe(23);
  });

  it('admits an integer 0…23 and nothing else', () => {
    expect(HourOfDay.is(0)).toBe(true);
    expect(HourOfDay.is(23)).toBe(true);
    expect(HourOfDay.is(24)).toBe(false);
    expect(HourOfDay.is(-1)).toBe(false);
    expect(HourOfDay.is(9.5)).toBe(false);
    expect(HourOfDay.is('9')).toBe(false);
    expect(HourOfDay.is(null)).toBe(false);
  });

  it('reads the hour of a minute of the day, and the first minute of an hour', () => {
    expect(HourOfDay.ofMinute(MinuteOfDay.ofProven(0))).toBe(0);
    expect(HourOfDay.ofMinute(MinuteOfDay.ofProven(585))).toBe(9);
    expect(HourOfDay.ofMinute(MinuteOfDay.ofProven(600))).toBe(10);
    expect(HourOfDay.ofMinute(MinuteOfDay.ofProven(1439))).toBe(23);
    expect(HourOfDay.startMinute(9)).toBe(540);
    expect(HourOfDay.startMinute(0)).toBe(0);
  });
});
