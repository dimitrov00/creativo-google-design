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

describe('LocalizedText.blank, with', () => {
  it('starts every locale empty, and replaces one without touching the input', () => {
    const blank = LocalizedText.blank();
    expect(blank).toEqual({ bg: '', en: '' });

    const typed = LocalizedText.with(blank, Locale.Bg, 'Коса');
    expect(typed).toEqual({ bg: 'Коса', en: '' });
    expect(blank).toEqual({ bg: '', en: '' });
  });
});

describe('LocalizedText.owedLocales', () => {
  const text = (bg: string, en: string): LocalizedText => ({ bg, en });

  it('owes every locale a required field is blank in, in dictionary order', () => {
    expect(
      LocalizedText.owedLocales([{ text: text('', '  '), required: true }]),
    ).toEqual([Locale.Bg, Locale.En]);
    expect(
      LocalizedText.owedLocales([{ text: text('Коса', ''), required: true }]),
    ).toEqual([Locale.En]);
  });

  it('owes an optional field only once it is written in another locale', () => {
    expect(
      LocalizedText.owedLocales([{ text: text('', ''), required: false }]),
    ).toEqual([]);
    expect(
      LocalizedText.owedLocales([
        { text: text('Пролет', ''), required: false },
      ]),
    ).toEqual([Locale.En]);
  });

  it('owes nothing when every field is whole, and names a locale once', () => {
    expect(
      LocalizedText.owedLocales([
        { text: text('Коса', 'Hair'), required: true },
        { text: text('Пролет', 'Spring'), required: false },
      ]),
    ).toEqual([]);
    expect(
      LocalizedText.owedLocales([
        { text: text('Коса', ''), required: true },
        { text: text('Пролет', ''), required: false },
      ]),
    ).toEqual([Locale.En]);
  });
});
