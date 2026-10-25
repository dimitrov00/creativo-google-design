import { localDate } from '@core/testing';
import { describe, expect, it } from 'vitest';
import { DayRangeFace, dayRange } from './day-range';

describe('dayRange — the house range', () => {
  const TODAY = localDate('2026-09-28');

  it('prints two dates as the locale’s own range, its spaced dash included', () => {
    expect(
      dayRange(localDate('2026-09-01'), localDate('2026-11-30'), TODAY, 'bg'),
    ).toBe('1.09 – 30.11');
    expect(
      dayRange(localDate('2026-10-08'), localDate('2026-10-09'), TODAY, 'bg'),
    ).toBe('8.10 – 9.10');
    expect(
      dayRange(localDate('2026-10-08'), localDate('2026-10-09'), TODAY, 'en'),
    ).toBe('10/8\u2009–\u200910/9');
  });

  it('names the years only when an end falls outside today’s', () => {
    expect(
      dayRange(localDate('2026-12-30'), localDate('2027-01-02'), TODAY, 'bg'),
    ).toBe('30.12.2026\u202fг. – 2.01.2027\u202fг.');
    expect(
      dayRange(localDate('2025-06-01'), localDate('2025-08-31'), TODAY, 'bg'),
    ).toBe('1.06 – 31.08.2025\u202fг.');
    // An unknown today names none, as a lone date does…
    expect(
      dayRange(localDate('2025-06-01'), localDate('2025-08-31'), null, 'bg'),
    ).toBe('1.06 – 31.08');
    // …unless the range itself crosses a year: that is `Intl`'s own call.
    expect(
      dayRange(localDate('2026-12-30'), localDate('2027-01-02'), null, 'bg'),
    ).toBe('30.12.2026\u202fг. – 2.01.2027\u202fг.');
  });

  it('prints weekdays when asked, with no year', () => {
    expect(
      dayRange(
        localDate('2026-10-01'),
        localDate('2026-10-02'),
        TODAY,
        'bg',
        DayRangeFace.Weekday,
      ),
    ).toBe('чт – пт');
    expect(
      dayRange(
        localDate('2026-10-01'),
        localDate('2026-10-02'),
        TODAY,
        'en',
        DayRangeFace.Weekday,
      ),
    ).toBe('Thu\u2009–\u2009Fri');
  });

  it('reads a day on its own calendar, whatever the device zone', () => {
    // Noon UTC: no zone from −12 to +14 moves it to a neighbour.
    expect(
      dayRange(localDate('2026-03-29'), localDate('2026-03-30'), TODAY, 'bg'),
    ).toBe('29.03 – 30.03');
  });
});
