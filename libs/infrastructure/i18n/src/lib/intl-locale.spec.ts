import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { intlLocaleOf } from './intl-locale';

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
