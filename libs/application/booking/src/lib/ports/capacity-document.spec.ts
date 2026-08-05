import { describe, expect, it } from 'vitest';
import { capacityMonthKey, freeMinutesFor } from './capacity-document';

describe('capacity-document', () => {
  it('derives the month key from a day key', () => {
    expect(capacityMonthKey('2026-08-14')).toBe('2026-08');
  });

  const entry = {
    ivan: { 'loc-center': 240 },
    stefan: { 'loc-center': 180, 'loc-mladost': 60 },
  };

  it('sums every shop for "any shop"', () => {
    expect(freeMinutesFor(entry, ['ivan', 'stefan'], null)).toBe(480);
  });

  it('narrows to one shop when a location is chosen', () => {
    expect(freeMinutesFor(entry, ['ivan', 'stefan'], 'loc-mladost')).toBe(60);
  });

  // The rollup stores per-barber contributions precisely so a barber the
  // catalog no longer lists stops counting immediately, without a sweep.
  it('counts only the barbers the caller names', () => {
    expect(freeMinutesFor(entry, ['stefan'], null)).toBe(240);
    expect(freeMinutesFor(entry, ['ghost'], null)).toBe(0);
  });

  it('reads an absent day, a malformed barber and a junk value as zero', () => {
    expect(freeMinutesFor(undefined, ['ivan'], null)).toBe(0);
    expect(freeMinutesFor({ ivan: 'corrupt' }, ['ivan'], null)).toBe(0);
    expect(
      freeMinutesFor({ ivan: { 'loc-center': 'NaN-ish' } }, ['ivan'], null),
    ).toBe(0);
  });
});
