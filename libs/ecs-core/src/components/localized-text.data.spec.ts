import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { LocalizedText } from './localized-text.data';

// catalog localized-text.spec.ts, on the plain { bg, en } struct.
describe('LocalizedText.parse', () => {
  it('accepts non-empty en/bg strings', () => {
    expect(LocalizedText.parse({ en: 'Haircut', bg: 'Подстригване' })).toEqual({
      ok: true,
      value: { en: 'Haircut', bg: 'Подстригване' },
    });
  });

  it('trims surrounding whitespace', () => {
    expect(LocalizedText.parse({ en: '  Haircut  ', bg: ' Коса ' })).toEqual({
      ok: true,
      value: { en: 'Haircut', bg: 'Коса' },
    });
  });

  it('rejects a blank en field', () => {
    expect(LocalizedText.parse({ en: '  ', bg: 'Коса' })).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY', locale: Locale.En },
      ],
    });
  });

  it('rejects a blank bg field', () => {
    expect(LocalizedText.parse({ en: 'Haircut', bg: '' })).toEqual({
      ok: false,
      error: [
        { errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY', locale: Locale.Bg },
      ],
    });
  });

  it('collects both field errors at once when both are blank, en first', () => {
    const result = LocalizedText.parse({ en: '', bg: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveLength(2);
      expect(result.error[0]).toEqual({
        errorCode: 'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
        locale: 'en',
      });
    }
  });
});

describe('LocalizedText.pick', () => {
  it('reads the field for a locale', () => {
    const text: LocalizedText = { en: 'Haircut', bg: 'Подстригване' };
    expect(LocalizedText.pick(text, Locale.En)).toBe('Haircut');
    expect(LocalizedText.pick(text, Locale.Bg)).toBe('Подстригване');
  });
});

describe('LocalizedText.equals', () => {
  it('compares both locale fields', () => {
    const a: LocalizedText = { en: 'Haircut', bg: 'Коса' };
    expect(LocalizedText.equals(a, { en: 'Haircut', bg: 'Коса' })).toBe(true);
    expect(LocalizedText.equals(a, { en: 'Shave', bg: 'Коса' })).toBe(false);
    expect(LocalizedText.equals(a, { en: 'Haircut', bg: 'Бръснене' })).toBe(
      false,
    );
  });
});
