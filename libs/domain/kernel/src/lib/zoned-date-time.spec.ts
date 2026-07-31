import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from './zoned-date-time';

describe('ZonedDateTime.fromISO', () => {
  it('accepts a valid ISO string with a valid IANA zone', () => {
    const result = ZonedDateTime.fromISO(
      '2026-08-01T09:00:00.000',
      'Europe/Sofia',
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a malformed ISO string', () => {
    const result = ZonedDateTime.fromISO('not-a-date', 'Europe/Sofia');
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an invalid IANA zone', () => {
    const result = ZonedDateTime.fromISO(
      '2026-08-01T09:00:00.000',
      'Not/AZone',
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('ZonedDateTime.now', () => {
  it('succeeds for a valid zone', () => {
    const result = ZonedDateTime.now('Europe/Sofia');
    expect(result.isSuccess()).toBe(true);
  });

  it('fails for an invalid zone', () => {
    const result = ZonedDateTime.now('Not/AZone');
    expect(result.isFailure()).toBe(true);
  });
});

describe('ZonedDateTime.isValidZone', () => {
  it('recognizes a real IANA zone', () => {
    expect(ZonedDateTime.isValidZone('Europe/Sofia')).toBe(true);
  });

  it('rejects a bogus zone', () => {
    expect(ZonedDateTime.isValidZone('Not/AZone')).toBe(false);
  });
});

describe('ZonedDateTime comparisons and arithmetic', () => {
  function at(iso: string): ZonedDateTime {
    const result = ZonedDateTime.fromISO(iso, 'UTC');
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    return result.value;
  }

  it('plusMinutes() advances the time', () => {
    const start = at('2026-08-01T09:00:00.000Z');
    const later = start.plusMinutes(30);
    expect(later.toISO()).toContain('09:30:00');
  });

  it('isBefore()/isAfter() compare correctly', () => {
    const earlier = at('2026-08-01T09:00:00.000Z');
    const later = at('2026-08-01T09:30:00.000Z');
    expect(earlier.isBefore(later)).toBe(true);
    expect(later.isAfter(earlier)).toBe(true);
    expect(later.isBefore(earlier)).toBe(false);
  });

  it('zoneName reflects the constructed zone', () => {
    const result = ZonedDateTime.fromISO(
      '2026-08-01T09:00:00.000',
      'Europe/Sofia',
    );
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.zoneName).toBe('Europe/Sofia');
  });

  it('isSameOrBefore()/isSameOrAfter() include the equal instant', () => {
    const a = at('2026-08-01T09:00:00.000Z');
    const b = at('2026-08-01T09:00:00.000Z');
    const later = at('2026-08-01T09:30:00.000Z');
    expect(a.isSameOrBefore(b)).toBe(true);
    expect(a.isSameOrAfter(b)).toBe(true);
    expect(a.isSameOrBefore(later)).toBe(true);
    expect(later.isSameOrBefore(a)).toBe(false);
    expect(a.isSameOrAfter(later)).toBe(false);
  });

  it('year/month/day expose the calendar date in the constructed zone', () => {
    const result = ZonedDateTime.fromISO('2026-03-05T10:00:00', 'Europe/Sofia');
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.year).toBe(2026);
    expect(result.value.month).toBe(3);
    expect(result.value.day).toBe(5);
  });

  it('yearsUntil() computes whole calendar years, counting a birthday only once it has passed', () => {
    const birthDate = at('2000-06-15T00:00:00.000Z');
    const justBefore = at('2026-06-14T00:00:00.000Z');
    const onTheDay = at('2026-06-15T00:00:00.000Z');
    const justAfter = at('2026-06-16T00:00:00.000Z');
    expect(birthDate.yearsUntil(justBefore)).toBe(25);
    expect(birthDate.yearsUntil(onTheDay)).toBe(26);
    expect(birthDate.yearsUntil(justAfter)).toBe(26);
  });

  it('plusDays()/plusMonths() move forward and backward', () => {
    const start = at('2026-01-31T09:00:00.000Z');
    expect(start.plusDays(1).day).toBe(1);
    expect(start.plusDays(1).month).toBe(2);
    expect(start.plusDays(-1).day).toBe(30);
    expect(start.plusMonths(1).month).toBe(2);
    expect(start.plusMonths(-1).month).toBe(12);
    expect(start.plusMonths(-1).year).toBe(2025);
  });

  it('startOfMonth() resets to midnight on the 1st', () => {
    const mid = at('2026-03-17T14:32:00.000Z');
    const start = mid.startOfMonth();
    expect(start.day).toBe(1);
    expect(start.hour).toBe(0);
    expect(start.minute).toBe(0);
  });

  it('hour/minute/weekday/daysInMonth expose calendar fields', () => {
    const result = ZonedDateTime.fromISO('2026-03-05T14:32:00', 'Europe/Sofia');
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    const value = result.value;
    expect(value.hour).toBe(14);
    expect(value.minute).toBe(32);
    expect(value.weekday).toBe(4); // Thursday
    expect(value.daysInMonth).toBe(31);
  });

  it('toLocaleString() formats using the given locale/options', () => {
    const value = at('2026-06-15T10:00:00.000Z');
    expect(value.toLocaleString('en', { weekday: 'short' })).toBe('Mon');
  });
});

describe('ZonedDateTime.weekdayLabels', () => {
  it('returns 7 Monday-first short weekday labels', () => {
    const labels = ZonedDateTime.weekdayLabels('Europe/Sofia', 'en');
    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe('Mon');
    expect(labels[6]).toBe('Sun');
  });
});

/*
 * ── DST ────────────────────────────────────────────────────────────────
 * Europe/Sofia, the product's scheduling zone, moves the clock twice a year:
 *   2026-03-29  02:00 → 03:00   the day is 23 hours; 03:00–03:59 never happens
 *   2026-10-25  04:00 → 03:00   the day is 25 hours; 03:00–03:59 happens twice
 * Every case below was verified against Luxon before being written down.
 */
describe('ZonedDateTime.fromParts — DST is an explicit decision', () => {
  const zone = 'Europe/Sofia';

  it('builds an ordinary wall-clock time', () => {
    const result = ZonedDateTime.fromParts(
      { year: 2026, month: 7, day: 29, hour: 9, minute: 30 },
      zone,
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.hour).toBe(9);
      expect(result.value.minute).toBe(30);
    }
  });

  it('REJECTS a time the spring-forward skipped, which Luxon accepts silently', () => {
    // Luxon returns 04:30+03:00 with isValid true. Accepting that books a
    // barber an hour after the roster said, once a year, with no error.
    const result = ZonedDateTime.fromParts(
      { year: 2026, month: 3, day: 29, hour: 3, minute: 30 },
      zone,
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('nonexistent_local_time');
    }
  });

  it('shifts a skipped time forward only when asked', () => {
    const result = ZonedDateTime.fromParts(
      { year: 2026, month: 3, day: 29, hour: 3, minute: 30 },
      zone,
      'shiftForward',
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.hour).toBe(4);
    }
  });

  it('REJECTS a time the fall-back repeated, rather than silently picking one', () => {
    const result = ZonedDateTime.fromParts(
      { year: 2026, month: 10, day: 25, hour: 3, minute: 30 },
      zone,
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('ambiguous_local_time');
    }
  });

  it('resolves a repeated time to either occurrence on request, an hour apart', () => {
    const parts = { year: 2026, month: 10, day: 25, hour: 3, minute: 30 };
    const earlier = ZonedDateTime.fromParts(parts, zone, 'earlier');
    const later = ZonedDateTime.fromParts(parts, zone, 'later');
    if (earlier.isFailure() || later.isFailure())
      throw new Error('bad fixture');

    // Same wall clock, different instants — which is what "ambiguous" means.
    expect(earlier.value.hour).toBe(3);
    expect(later.value.hour).toBe(3);
    expect(earlier.value.minutesUntil(later.value)).toBe(60);
  });

  it('rejects an unknown zone and impossible parts', () => {
    expect(
      ZonedDateTime.fromParts(
        { year: 2026, month: 7, day: 29, hour: 9, minute: 0 },
        'Not/AZone',
      ).isFailure(),
    ).toBe(true);
    expect(
      ZonedDateTime.fromParts(
        { year: 2026, month: 2, day: 30, hour: 9, minute: 0 },
        zone,
      ).isFailure(),
    ).toBe(true);
  });
});

describe('ZonedDateTime day boundaries across DST', () => {
  const zone = 'Europe/Sofia';

  function at(iso: string): ZonedDateTime {
    const result = ZonedDateTime.fromISO(iso, zone);
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  }

  it('measures the spring day as 23 hours and the autumn day as 25', () => {
    // The reason `startOfNextDay` is calendar arithmetic and not +24h.
    const spring = at('2026-03-29T12:00:00');
    expect(spring.startOfDay().minutesUntil(spring.startOfNextDay())).toBe(
      23 * 60,
    );

    const autumn = at('2026-10-25T12:00:00');
    expect(autumn.startOfDay().minutesUntil(autumn.startOfNextDay())).toBe(
      25 * 60,
    );
  });

  it('startOfDay lands on local midnight, not UTC midnight', () => {
    const start = at('2026-07-29T23:45:00').startOfDay();
    expect(start.hour).toBe(0);
    expect(start.toISODate()).toBe('2026-07-29');
  });

  it('atTime places a roster window on a specific date', () => {
    const nine = at('2026-07-29T00:00:00').atTime(9, 0);
    expect(nine.isSuccess()).toBe(true);
    if (nine.isSuccess()) {
      expect(nine.value.hour).toBe(9);
      expect(nine.value.toISODate()).toBe('2026-07-29');
    }
  });

  it('atTime refuses a roster window the spring-forward erased', () => {
    const result = at('2026-03-29T00:00:00').atTime(3, 30);
    expect(result.isFailure()).toBe(true);
  });
});

describe('ZonedDateTime instants', () => {
  const zone = 'Europe/Sofia';

  it('round-trips through epoch millis', () => {
    const original = ZonedDateTime.fromISO('2026-07-29T10:15:00', zone);
    if (original.isFailure()) throw new Error('bad fixture');
    const restored = ZonedDateTime.fromMillis(original.value.toMillis(), zone);
    if (restored.isFailure()) throw new Error('bad fixture');
    expect(restored.value.equals(original.value)).toBe(true);
  });

  it('compares by INSTANT, not by the offset the local rendering carries', () => {
    // The bug this guards: '…+03:00' sorts after '…+02:00' as a STRING while
    // being the earlier instant — which inverts ordering during the autumn
    // fall-back hour.
    const earlier = ZonedDateTime.fromISO('2026-10-25T03:30:00+03:00', zone);
    const later = ZonedDateTime.fromISO('2026-10-25T03:30:00+02:00', zone);
    if (earlier.isFailure() || later.isFailure())
      throw new Error('bad fixture');

    expect(earlier.value.isBefore(later.value)).toBe(true);
    expect(earlier.value.toMillis()).toBeLessThan(later.value.toMillis());
  });

  it('minutesUntil measures elapsed time across a DST boundary, not clock difference', () => {
    // 01:30 → 04:30 reads as three hours on the wall clock but only two
    // actually pass, because 03:00–03:59 does not exist.
    const before = ZonedDateTime.fromISO('2026-03-29T01:30:00', zone);
    const after = ZonedDateTime.fromISO('2026-03-29T04:30:00', zone);
    if (before.isFailure() || after.isFailure()) throw new Error('bad fixture');
    expect(before.value.minutesUntil(after.value)).toBe(120);
  });

  it('min/max pick by instant', () => {
    const a = ZonedDateTime.fromISO('2026-07-29T09:00:00', zone);
    const b = ZonedDateTime.fromISO('2026-07-29T11:00:00', zone);
    const c = ZonedDateTime.fromISO('2026-07-29T10:00:00', zone);
    if (a.isFailure() || b.isFailure() || c.isFailure()) {
      throw new Error('bad fixture');
    }
    expect(ZonedDateTime.min(a.value, b.value, c.value).hour).toBe(9);
    expect(ZonedDateTime.max(a.value, b.value, c.value).hour).toBe(11);
  });
});
