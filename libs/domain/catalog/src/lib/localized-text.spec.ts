import { describe, expect, it } from 'vitest';
import { LocalizedText } from './localized-text';

describe('LocalizedText.create', () => {
  it('accepts non-empty en/bg strings', () => {
    const result = LocalizedText.create({ en: 'Haircut', bg: 'Подстригване' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.en).toBe('Haircut');
      expect(result.value.bg).toBe('Подстригване');
      expect(result.value.get('en')).toBe('Haircut');
      expect(result.value.get('bg')).toBe('Подстригване');
      expect(result.value.toString()).toBe('Haircut');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = LocalizedText.create({ en: '  Haircut  ', bg: ' Коса ' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.en).toBe('Haircut');
      expect(result.value.bg).toBe('Коса');
    }
  });

  it('rejects a blank en field', () => {
    const result = LocalizedText.create({ en: '  ', bg: 'Коса' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0]?.code).toBe('catalog.localized_text.field_empty');
    }
  });

  it('rejects a blank bg field', () => {
    expect(LocalizedText.create({ en: 'Haircut', bg: '' }).isFailure()).toBe(
      true,
    );
  });

  it('collects both field errors at once when both are blank', () => {
    const result = LocalizedText.create({ en: '', bg: '' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(2);
    }
  });
});

describe('LocalizedText.fromPrimitive', () => {
  it('builds without validation from trusted persistence data', () => {
    const text = LocalizedText.fromPrimitive({ en: 'Haircut', bg: 'Коса' });
    expect(text.en).toBe('Haircut');
    expect(text.bg).toBe('Коса');
  });
});

describe('LocalizedText.equals', () => {
  it('compares both locale fields', () => {
    const a = LocalizedText.fromPrimitive({ en: 'Haircut', bg: 'Коса' });
    const b = LocalizedText.fromPrimitive({ en: 'Haircut', bg: 'Коса' });
    const c = LocalizedText.fromPrimitive({ en: 'Shave', bg: 'Коса' });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
