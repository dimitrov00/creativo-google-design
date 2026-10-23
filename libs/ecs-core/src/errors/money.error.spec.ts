import { describe, expect, it } from 'vitest';
import { Currency } from '@core/primitives';
import { MoneyError, MoneyErrorCode } from './money.error';

describe('MoneyError', () => {
  it('builds each struct with its SCREAMING errorCode and i18n params', () => {
    expect(MoneyError.invalidAmount(-1)).toEqual({
      errorCode: 'MONEY_INVALID_AMOUNT',
      rawAmount: -1,
    });
    expect(MoneyError.currencyMismatch(Currency.EUR, Currency.BGN)).toEqual({
      errorCode: 'MONEY_CURRENCY_MISMATCH',
      leftCurrency: 'EUR',
      rightCurrency: 'BGN',
    });
    expect(MoneyError.unknownCurrency('XXX')).toEqual({
      errorCode: 'MONEY_UNKNOWN_CURRENCY',
      rawCode: 'XXX',
    });
    expect(MoneyError.invalidRatio(1, 0)).toEqual({
      errorCode: 'MONEY_INVALID_RATIO',
      numerator: 1,
      denominator: 0,
    });
  });

  it('keeps every code under the MONEY_ prefix, each once', () => {
    const codes = Object.values(MoneyErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^MONEY_[A-Z_]+$/);
  });

  it('is() narrows by code', () => {
    const error: MoneyError = MoneyError.currencyMismatch(
      Currency.EUR,
      Currency.BGN,
    );
    expect(MoneyError.is(error, MoneyErrorCode.CurrencyMismatch)).toBe(true);
    expect(MoneyError.is(error, MoneyErrorCode.InvalidAmount)).toBe(false);
    if (MoneyError.is(error, MoneyErrorCode.CurrencyMismatch)) {
      expect(error.rightCurrency).toBe('BGN');
    }
  });
});
