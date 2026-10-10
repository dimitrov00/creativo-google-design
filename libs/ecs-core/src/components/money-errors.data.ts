/**
 * The money context's error codes — the kernel's flat `invalid_money_amount`,
 * `currency_mismatch` and `unknown_currency_code` (`money.errors.ts`), and
 * governance's `governance.currency_code.unknown` (`currency-code.errors.ts`),
 * renamed to the dotted convention and collapsed into one dictionary
 * (blueprint §2.5, catalog-kernel Q13). Every non-`code` field is an i18n
 * parameter, so each one is an i18n-safe scalar.
 */
export const MoneyErrorCode = {
  /** Not a non-negative safe-integer count of minor units. */
  InvalidAmount: 'money.invalid_amount',
  /** Two figures in different currencies met in one operation. */
  CurrencyMismatch: 'money.currency_mismatch',
  /** A currency code outside the `Currency` dictionary. */
  UnknownCurrency: 'money.unknown_currency',
  /** A `Money.scale` ratio that is not `integer / positive integer`. */
  InvalidRatio: 'money.invalid_ratio',
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
    return { code: MoneyErrorCode.InvalidAmount, rawAmount };
  },
  currencyMismatch(
    leftCurrency: string,
    rightCurrency: string,
  ): MoneyError.CurrencyMismatch {
    return {
      code: MoneyErrorCode.CurrencyMismatch,
      leftCurrency,
      rightCurrency,
    };
  },
  unknownCurrency(rawCode: string): MoneyError.UnknownCurrency {
    return { code: MoneyErrorCode.UnknownCurrency, rawCode };
  },
  invalidRatio(
    numerator: number,
    denominator: number,
  ): MoneyError.InvalidRatio {
    return { code: MoneyErrorCode.InvalidRatio, numerator, denominator };
  },
  /** Narrows an error to one code — `MoneyError.is(e, MoneyErrorCode.CurrencyMismatch)`. */
  is<C extends MoneyErrorCode>(
    error: MoneyError,
    code: C,
  ): error is Extract<MoneyError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace MoneyError {
  export type InvalidAmount = {
    readonly code: typeof MoneyErrorCode.InvalidAmount;
    readonly rawAmount: number;
  };
  export type CurrencyMismatch = {
    readonly code: typeof MoneyErrorCode.CurrencyMismatch;
    readonly leftCurrency: string;
    readonly rightCurrency: string;
  };
  export type UnknownCurrency = {
    readonly code: typeof MoneyErrorCode.UnknownCurrency;
    readonly rawCode: string;
  };
  export type InvalidRatio = {
    readonly code: typeof MoneyErrorCode.InvalidRatio;
    readonly numerator: number;
    readonly denominator: number;
  };
}
