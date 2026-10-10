import { describe, expect, it } from 'vitest';
import { CurrencyCode } from './currency-code.data';
import { Currency } from './money.data';
import { MoneyErrorCode } from './money-errors.data';
import type { Result } from './result.data';

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error('unexpected failure in test fixture');
  return result.value;
}

// governance currency-code.spec.ts, on the brand; the unknown code is the
// money dictionary's (one currency vocabulary, `Currency`).
describe('CurrencyCode.parse', () => {
  it('accepts a recognised currency code, normalised to upper case', () => {
    expect(CurrencyCode.parse('eur')).toEqual({ ok: true, value: 'EUR' });
    expect(CurrencyCode.parse(' Eur ')).toEqual({
      ok: true,
      value: Currency.EUR,
    });
  });

  it('rejects retired leva — BGN is not a recognised currency (§2.7)', () => {
    expect(CurrencyCode.parse('BGN')).toEqual({
      ok: false,
      error: { code: MoneyErrorCode.UnknownCurrency, rawCode: 'BGN' },
    });
  });

  it('rejects an unknown currency code with the raw text', () => {
    expect(CurrencyCode.parse('XYZ')).toEqual({
      ok: false,
      error: { code: MoneyErrorCode.UnknownCurrency, rawCode: 'XYZ' },
    });
  });
});

describe('CurrencyCode.of / equals', () => {
  it('casts a trusted value and compares by value', () => {
    const parsed = valueOf(CurrencyCode.parse('eur'));
    expect(CurrencyCode.equals(CurrencyCode.of('EUR'), parsed)).toBe(true);
    expect(
      CurrencyCode.equals(CurrencyCode.of('BGN'), CurrencyCode.of('EUR')),
    ).toBe(false);
  });

  it('is nominal: a raw string is not a CurrencyCode', () => {
    // @ts-expect-error — only CurrencyCode.of / parse make one
    const raw: CurrencyCode = 'EUR';
    expect(raw).toBe('EUR');
  });
});
