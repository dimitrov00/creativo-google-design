import { describe, expect, it } from 'vitest';
import { unwrapErr } from '../testing';
import { Currency } from './currency.primitive';

/*
 * The successor of `components/currency-code.data.spec.ts` (flatten-spec
 * §1.4): one currency vocabulary, the `Currency` brand.
 */
describe('Currency — an ISO-4217 code', () => {
  it('names the four codes a stored amount may carry', () => {
    expect([Currency.EUR, Currency.BGN, Currency.USD, Currency.GBP]).toEqual([
      'EUR',
      'BGN',
      'USD',
      'GBP',
    ]);
  });

  it('parse trims and upper-cases a known code', () => {
    expect(Currency.parse(' eur ')).toEqual({ ok: true, value: 'EUR' });
    expect(Currency.parse('bgn')).toEqual({ ok: true, value: 'BGN' });
  });

  it('parse refuses an unknown code with the raw text', () => {
    expect(unwrapErr(Currency.parse('XYZ'))).toEqual({
      errorCode: 'PRIMITIVE_CURRENCY_UNKNOWN',
      raw: 'XYZ',
      brand: 'Currency',
    });
    expect(Currency.parse('').ok).toBe(false);
  });

  it('tradable is EUR only — what a new amount may be priced in', () => {
    expect(Currency.tradable(' eur ')).toBe(Currency.EUR);
    expect(Currency.tradable('BGN')).toBeNull();
    expect(Currency.tradable('GBP')).toBeNull();
    expect(Currency.tradable('')).toBeNull();
  });
});
