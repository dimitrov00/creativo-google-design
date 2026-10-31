import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { DEFAULT_LOCALE, intlLocaleOf, localeFor } from './intl-locale';

describe('intlLocaleOf — the UI language as the Intl locale it formats in', () => {
  it('formats English as en-GB and Bulgarian as bg-BG', () => {
    expect(intlLocaleOf(Locale.En)).toBe('en-GB');
    expect(intlLocaleOf(Locale.Bg)).toBe('bg-BG');
  });

  it('reads any other language as Bulgarian — the two ternaries it replaced (`lang === "en" ? "en-GB" : "bg-BG"`)', () => {
    for (const lang of ['de', 'EN', 'en-GB', '', 'bg-BG']) {
      expect(intlLocaleOf(lang)).toBe(lang === 'en' ? 'en-GB' : 'bg-BG');
    }
  });

  it('is pure: same input → same output', () => {
    expect(intlLocaleOf('en')).toBe(intlLocaleOf('en'));
    expect(intlLocaleOf('fr')).toBe(intlLocaleOf('fr'));
  });
});

describe('localeFor — the one active-language rule', () => {
  it('reads a known language as itself', () => {
    expect(localeFor('en')).toBe(Locale.En);
    expect(localeFor('bg')).toBe(Locale.Bg);
  });

  it('reads anything else as the app’s default, Bulgarian', () => {
    expect(DEFAULT_LOCALE).toBe(Locale.Bg);
    for (const lang of ['fr', 'de', 'EN', '', null, undefined, 7]) {
      expect(localeFor(lang)).toBe(DEFAULT_LOCALE);
    }
  });

  // Moved from the client card's `cardLocaleOf` (deleted; its readers call this).
  it('reads any language but English as the shop’s own', () => {
    expect(localeFor('en')).toBe('en');
    expect(localeFor('bg')).toBe('bg');
    expect(localeFor('de')).toBe('bg');
  });

  it('is pure: same input → same output', () => {
    expect(localeFor('en')).toBe(localeFor('en'));
    expect(localeFor('fr')).toBe(localeFor('fr'));
  });
});
