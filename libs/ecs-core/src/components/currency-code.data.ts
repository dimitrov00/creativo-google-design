import { Money } from './money.data';
import { MoneyError } from './money-errors.data';
import { Result } from './result.data';

/**
 * An ISO 4217 currency code as a brand over the plain stored string (§9 D22).
 * The recognised values are the `Currency` dictionary of `money.data.ts` —
 * there is no second currency vocabulary here; `parse` delegates to
 * `Money.currencyFrom`, the one recognition rule (governance's
 * `CurrencyCode.create` and the kernel's `currencyFromCode` collapsed).
 */
export type CurrencyCode = string & { readonly __brand: unique symbol };

export const CurrencyCode = {
  /** The only cast site. Validate a raw string with `parse` at the edge, not here. */
  of: (raw: string): CurrencyCode => raw as CurrencyCode,

  /**
   * The edge guard: trimmed, upper-cased (`'eur'` → `'EUR'`) and recognised,
   * or `money.unknown_currency` carrying the raw text.
   */
  parse(raw: string): Result<CurrencyCode, MoneyError> {
    const currency = Money.currencyFrom(raw);
    return currency === null
      ? Result.err(MoneyError.unknownCurrency(raw))
      : Result.ok(CurrencyCode.of(currency));
  },

  equals(a: CurrencyCode, b: CurrencyCode): boolean {
    return a === b;
  },
} as const;
