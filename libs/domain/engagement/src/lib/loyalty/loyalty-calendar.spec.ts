import { describe, expect, it } from 'vitest';
import { daysBetween, isIsoDate, sofiaDayOf } from './loyalty-calendar';

describe('isIsoDate', () => {
  it.each(['2026-09-28', '2024-02-29', '2026-12-31'])('takes %s', (raw) => {
    expect(isIsoDate(raw)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-9-28',
    '2026-09-28T00:00:00.000Z',
    '28.09.2026',
    '',
    null,
    20260928,
  ])('refuses %j', (raw) => {
    expect(isIsoDate(raw)).toBe(false);
  });
});

describe('sofiaDayOf', () => {
  it('reads the day on the Sofia clock, not the UTC one', () => {
    // 22:30 UTC in summer is 01:30 the next morning in Sofia (UTC+3).
    expect(sofiaDayOf(new Date('2026-07-31T22:30:00.000Z'))).toBe('2026-08-01');
    expect(sofiaDayOf(new Date('2026-07-31T20:59:59.000Z'))).toBe('2026-07-31');
  });

  it('follows the winter offset too (UTC+2)', () => {
    expect(sofiaDayOf(new Date('2026-12-31T21:59:59.000Z'))).toBe('2026-12-31');
    expect(sofiaDayOf(new Date('2026-12-31T22:00:00.000Z'))).toBe('2027-01-01');
  });
});

describe('daysBetween', () => {
  it('counts calendar days, signed', () => {
    expect(daysBetween('2026-09-01', '2026-09-28')).toBe(27);
    expect(daysBetween('2026-09-28', '2026-09-01')).toBe(-27);
    expect(daysBetween('2026-09-28', '2026-09-28')).toBe(0);
  });

  // The autumn transition makes one Sofia day 25 hours long; days are still days.
  it('is not thrown by a DST change', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
});
