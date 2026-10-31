import { describe, expect, it } from 'vitest';
import { AppCheckMode } from './app-check-mode.data';
import { Tag } from './tag.data';

// The App Check switch (security hardening S-RU-19, S-L-1): three staged
// values, read at the edge through the one membership scan.
describe('AppCheckMode — the App Check switch', () => {
  it('is exactly the three staged modes, in rollout order, each value once', () => {
    expect(Tag.values(AppCheckMode)).toEqual(['OFF', 'MONITOR', 'ENFORCE']);
    const values = Tag.values(AppCheckMode);
    expect(new Set(values).size).toBe(values.length);
  });

  it('spells every value SCREAMING_SNAKE (Law 1)', () => {
    for (const value of Tag.values(AppCheckMode)) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('Tag.has accepts each mode and rejects an unset, a lower-case or a non-string value', () => {
    for (const value of Tag.values(AppCheckMode)) {
      expect(Tag.has(AppCheckMode, value)).toBe(true);
    }
    // An unset param reads '' (S-RU-19): never a mode.
    expect(Tag.has(AppCheckMode, '')).toBe(false);
    expect(Tag.has(AppCheckMode, 'monitor')).toBe(false);
    expect(Tag.has(AppCheckMode, 'ENFORCED')).toBe(false);
    expect(Tag.has(AppCheckMode, null)).toBe(false);
    expect(Tag.has(AppCheckMode, undefined)).toBe(false);
    expect(Tag.has(AppCheckMode, 1)).toBe(false);
  });

  it('Tag.or reads anything else as OFF — the fail-open fallback', () => {
    expect(Tag.or(AppCheckMode, 'ENFORCE', AppCheckMode.Off)).toBe(
      AppCheckMode.Enforce,
    );
    expect(Tag.or(AppCheckMode, '', AppCheckMode.Off)).toBe(AppCheckMode.Off);
    expect(Tag.or(AppCheckMode, 'enforce', AppCheckMode.Off)).toBe(
      AppCheckMode.Off,
    );
  });
});
