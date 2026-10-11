import { describe, expect, it } from 'vitest';
import { LOCALES, Locale, isLocale } from './locale.data';

// governance locale.spec.ts, on the dictionary.
describe('Locale', () => {
  it('is the two shop locales, derived from the dictionary', () => {
    expect(LOCALES).toEqual([Locale.Bg, Locale.En]);
    expect(LOCALES).toEqual(['bg', 'en']);
  });

  it('isLocale accepts "en" and "bg"', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('bg')).toBe(true);
  });

  it('isLocale rejects an unsupported locale, a different case and non-strings', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('de')).toBe(false);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('narrows to the dictionary type', () => {
    const raw: unknown = 'bg';
    if (isLocale(raw)) {
      const locale: Locale = raw;
      expect(locale).toBe(Locale.Bg);
    }
  });
});
