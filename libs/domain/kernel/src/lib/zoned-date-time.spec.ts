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
});
