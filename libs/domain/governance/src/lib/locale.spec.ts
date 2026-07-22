import { describe, expect, it } from 'vitest';
import { isLocale, parseLocale } from './locale';

describe('parseLocale', () => {
  it('accepts "en"', () => {
    expect(parseLocale('en').isSuccess()).toBe(true);
  });

  it('accepts "bg"', () => {
    expect(parseLocale('bg').isSuccess()).toBe(true);
  });

  it('rejects an unsupported locale', () => {
    const result = parseLocale('fr');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('governance.locale.invalid');
    }
  });
});

describe('isLocale', () => {
  it('rejects non-string / unknown values', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});
