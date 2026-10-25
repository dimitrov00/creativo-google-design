import { describe, expect, it } from 'vitest';
import { endMinute, localDate, minute } from '@core/testing';
import {
  formatBookingDay,
  formatBookingMonth,
  formatBookingTime,
} from './booking-wall-clock';

/*
 * The booking steps' clock faces print the characters they always printed
 * (R7) — a wall-clock reading formatted as it stands, in bg and en, with no
 * zone and no device clock consulted.
 */
describe('the booking steps’ clock faces', () => {
  const thursday = localDate('2026-08-20');

  it('says a minute of the shop day on the 24-hour clock, in both languages', () => {
    expect(formatBookingTime(thursday, minute(14 * 60), 'bg')).toBe('14:00');
    expect(formatBookingTime(thursday, minute(9 * 60 + 5), 'en')).toBe('09:05');
    // An end at the closing midnight reads as that midnight.
    expect(formatBookingTime(thursday, endMinute(1440), 'bg')).toBe('00:00');
  });

  it('spells the shop day out', () => {
    expect(formatBookingDay(thursday, 'bg')).toBe('четвъртък, 20 август');
    expect(formatBookingDay(thursday, 'en')).toBe('Thursday, August 20');
  });

  it('heads a month sentence-cased, its year only when asked for', () => {
    expect(formatBookingMonth(thursday, false, 'bg')).toBe('Август');
    expect(formatBookingMonth(localDate('2027-01-05'), true, 'bg')).toMatch(
      /^Януари 2027\sг\.$/,
    );
    expect(formatBookingMonth(thursday, false, 'en')).toBe('August');
    expect(formatBookingMonth(localDate('2027-01-05'), true, 'en')).toBe(
      'January 2027',
    );
  });
});
