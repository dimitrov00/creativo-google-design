import type { Currency } from '@core/primitives';

/**
 * The money context's error codes — the kernel's flat `invalid_money_amount`,
 * `currency_mismatch` and `unknown_currency_code` (`money.errors.ts`), and
 * governance's `governance.currency_code.unknown` (`currency-code.errors.ts`),
 * collapsed into one dictionary (blueprint §2.5, catalog-kernel Q13), its
 * values SCREAMING_SNAKE under the `MONEY_` prefix (flatten-spec §4.2). Every non-`errorCode` field is an i18n
 * parameter, so each one is an i18n-safe scalar.
 */
export const MoneyErrorCode = {
  /** Not a non-negative safe-integer count of minor units. */
  InvalidAmount: 'MONEY_INVALID_AMOUNT',
  /** Two figures in different currencies met in one operation. */
  CurrencyMismatch: 'MONEY_CURRENCY_MISMATCH',
  /** A currency code outside the `Currency` dictionary. */
  UnknownCurrency: 'MONEY_UNKNOWN_CURRENCY',
  /** A `Money.scale` ratio that is not `integer / positive integer`. */
  InvalidRatio: 'MONEY_INVALID_RATIO',
} as const;
export type MoneyErrorCode =
  (typeof MoneyErrorCode)[keyof typeof MoneyErrorCode];

export type MoneyError =
  | MoneyError.InvalidAmount
  | MoneyError.CurrencyMismatch
  | MoneyError.UnknownCurrency
  | MoneyError.InvalidRatio;

export const MoneyError = {
  invalidAmount(rawAmount: number): MoneyError.InvalidAmount {
    return { errorCode: MoneyErrorCode.InvalidAmount, rawAmount };
  },
  currencyMismatch(
    leftCurrency: Currency,
    rightCurrency: Currency,
  ): MoneyError.CurrencyMismatch {
    return {
      errorCode: MoneyErrorCode.CurrencyMismatch,
      leftCurrency,
      rightCurrency,
    };
  },
  unknownCurrency(rawCode: string): MoneyError.UnknownCurrency {
    return { errorCode: MoneyErrorCode.UnknownCurrency, rawCode };
  },
  invalidRatio(
    numerator: number,
    denominator: number,
  ): MoneyError.InvalidRatio {
    return { errorCode: MoneyErrorCode.InvalidRatio, numerator, denominator };
  },
  /** Narrows an error to one errorCode — `MoneyError.is(e, MoneyErrorCode.CurrencyMismatch)`. */
  is<C extends MoneyErrorCode>(
    error: MoneyError,
    errorCode: C,
  ): error is Extract<MoneyError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace MoneyError {
  export type InvalidAmount = {
    readonly errorCode: typeof MoneyErrorCode.InvalidAmount;
    readonly rawAmount: number;
  };
  export type CurrencyMismatch = {
    readonly errorCode: typeof MoneyErrorCode.CurrencyMismatch;
    readonly leftCurrency: Currency;
    readonly rightCurrency: Currency;
  };
  export type UnknownCurrency = {
    readonly errorCode: typeof MoneyErrorCode.UnknownCurrency;
    readonly rawCode: string;
  };
  export type InvalidRatio = {
    readonly errorCode: typeof MoneyErrorCode.InvalidRatio;
    readonly numerator: number;
    readonly denominator: number;
  };
}
