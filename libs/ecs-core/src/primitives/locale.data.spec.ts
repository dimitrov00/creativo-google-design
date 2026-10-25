import { describe, expect, it } from 'vitest';
import { Locale } from './locale.data';
import { Tag } from './tag.data';

// governance locale.spec.ts, on the dictionary. The list and the guard are
// the one membership scan, `Tag.values(Locale)` / `Tag.has(Locale, raw)`
// (pass D retired the `LOCALES` / `isLocale` delegates; their cases are
// restated here on the scan).
describe('Locale', () => {
  it('is the two shop locales, derived from the dictionary', () => {
    expect(Tag.values(Locale)).toEqual([Locale.Bg, Locale.En]);
    expect(Tag.values(Locale)).toEqual(['bg', 'en']);
  });

  it('Tag.has accepts "en" and "bg"', () => {
    expect(Tag.has(Locale, 'en')).toBe(true);
    expect(Tag.has(Locale, 'bg')).toBe(true);
  });

  it('Tag.has rejects an unsupported locale, a different case and non-strings', () => {
    expect(Tag.has(Locale, 'fr')).toBe(false);
    expect(Tag.has(Locale, 'de')).toBe(false);
    expect(Tag.has(Locale, 'EN')).toBe(false);
    expect(Tag.has(Locale, 42)).toBe(false);
    expect(Tag.has(Locale, null)).toBe(false);
  });

  it('narrows to the dictionary type', () => {
    const raw: unknown = 'bg';
    if (Tag.has(Locale, raw)) {
      const locale: Locale = raw;
      expect(locale).toBe(Locale.Bg);
    } else {
      expect.unreachable('bg is a locale');
    }
  });

  it('Tag.or reads anything else as the fallback', () => {
    expect(Tag.or(Locale, 'en', Locale.Bg)).toBe(Locale.En);
    expect(Tag.or(Locale, 'de', Locale.Bg)).toBe(Locale.Bg);
    expect(Tag.or(Locale, 'EN', Locale.Bg)).toBe(Locale.Bg);
  });
});
