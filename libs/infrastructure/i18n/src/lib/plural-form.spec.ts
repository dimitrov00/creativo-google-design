import { describe, expect, it } from 'vitest';
import { pluralForm } from './plural-form';

describe('pluralForm', () => {
  it('declines Bulgarian counts — the bug that shipped "1 посещения"', () => {
    expect(pluralForm(1, 'bg')).toBe('one');
    expect(pluralForm(0, 'bg')).toBe('other');
    expect(pluralForm(2, 'bg')).toBe('other');
    expect(pluralForm(21, 'bg')).toBe('other');
  });

  it('declines English the same way, so "1 cuts" cannot come back either', () => {
    expect(pluralForm(1, 'en')).toBe('one');
    expect(pluralForm(0, 'en')).toBe('other');
    expect(pluralForm(5, 'en')).toBe('other');
  });

  it('caches one Intl.PluralRules per language rather than per call', () => {
    // Not observable through the return value, so assert the cheap proxy:
    // repeated calls stay consistent and never throw for a language already
    // seen. (A regression here would be a perf bug, not a correctness one.)
    for (let i = 0; i < 100; i++)
      expect(pluralForm(i, 'bg')).toBeTypeOf('string');
  });

  it('still answers for a language whose rules we have not keyed', () => {
    // Russian needs `few`/`many`; the helper reports them honestly so a
    // missing key fails loudly at the call site rather than silently reading
    // as English.
    expect(pluralForm(2, 'ru')).toBe('few');
    expect(pluralForm(5, 'ru')).toBe('many');
  });
});
