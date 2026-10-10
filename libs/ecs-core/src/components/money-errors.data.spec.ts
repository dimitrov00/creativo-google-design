import { describe, expect, it } from 'vitest';
import { MoneyError, MoneyErrorCode } from './money-errors.data';

describe('MoneyError', () => {
  it('builds each struct with its dotted code and i18n params', () => {
    expect(MoneyError.invalidAmount(-1)).toEqual({
      code: 'money.invalid_amount',
      rawAmount: -1,
    });
    expect(MoneyError.currencyMismatch('EUR', 'BGN')).toEqual({
      code: 'money.currency_mismatch',
      leftCurrency: 'EUR',
      rightCurrency: 'BGN',
    });
    expect(MoneyError.unknownCurrency('XXX')).toEqual({
      code: 'money.unknown_currency',
      rawCode: 'XXX',
    });
    expect(MoneyError.invalidRatio(1, 0)).toEqual({
      code: 'money.invalid_ratio',
      numerator: 1,
      denominator: 0,
    });
  });

  it('keeps every code in the money namespace, each once', () => {
    const codes = Object.values(MoneyErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^money\.[a-z_]+$/);
  });

  it('is() narrows by code', () => {
    const error: MoneyError = MoneyError.currencyMismatch('EUR', 'BGN');
    expect(MoneyError.is(error, MoneyErrorCode.CurrencyMismatch)).toBe(true);
    expect(MoneyError.is(error, MoneyErrorCode.InvalidAmount)).toBe(false);
    if (MoneyError.is(error, MoneyErrorCode.CurrencyMismatch)) {
      expect(error.rightCurrency).toBe('BGN');
    }
  });
});
