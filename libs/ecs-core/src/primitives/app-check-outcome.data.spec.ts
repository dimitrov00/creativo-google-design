import { describe, expect, it } from 'vitest';
import { AppCheckOutcome } from './app-check-outcome.data';
import { Tag } from './tag.data';

// The outcome tag of the edge's line (security hardening S-RU-17): a tag,
// never the token.
describe('AppCheckOutcome — what App Check made of one request', () => {
  it('is exactly the four outcomes, each value once', () => {
    expect(Tag.values(AppCheckOutcome)).toEqual([
      'VALID',
      'MISSING',
      'INVALID',
      'REPLAYED',
    ]);
    const values = Tag.values(AppCheckOutcome);
    expect(new Set(values).size).toBe(values.length);
  });

  it('spells every value SCREAMING_SNAKE (Law 1)', () => {
    for (const value of Tag.values(AppCheckOutcome)) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('Tag.has accepts each outcome and rejects anything else', () => {
    for (const value of Tag.values(AppCheckOutcome)) {
      expect(Tag.has(AppCheckOutcome, value)).toBe(true);
    }
    expect(Tag.has(AppCheckOutcome, 'valid')).toBe(false);
    expect(Tag.has(AppCheckOutcome, 'CONSUMED')).toBe(false);
    expect(Tag.has(AppCheckOutcome, '')).toBe(false);
    expect(Tag.has(AppCheckOutcome, null)).toBe(false);
  });
});
