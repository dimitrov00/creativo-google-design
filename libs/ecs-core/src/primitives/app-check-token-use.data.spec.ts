import { describe, expect, it } from 'vitest';
import { AppCheckTokenUse } from './app-check-token-use.data';
import { Tag } from './tag.data';

// Which token a callable takes (security hardening S-RU-21, S-L-3).
describe('AppCheckTokenUse — the token a callable takes', () => {
  it('is exactly the two uses, each value once', () => {
    expect(Tag.values(AppCheckTokenUse)).toEqual(['STANDARD', 'LIMITED_USE']);
    const values = Tag.values(AppCheckTokenUse);
    expect(new Set(values).size).toBe(values.length);
  });

  it('spells every value SCREAMING_SNAKE (Law 1)', () => {
    for (const value of Tag.values(AppCheckTokenUse)) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('Tag.has accepts each use and rejects anything else', () => {
    for (const value of Tag.values(AppCheckTokenUse)) {
      expect(Tag.has(AppCheckTokenUse, value)).toBe(true);
    }
    expect(Tag.has(AppCheckTokenUse, 'limited_use')).toBe(false);
    expect(Tag.has(AppCheckTokenUse, 'LIMITED')).toBe(false);
    expect(Tag.has(AppCheckTokenUse, '')).toBe(false);
    expect(Tag.has(AppCheckTokenUse, null)).toBe(false);
  });
});
