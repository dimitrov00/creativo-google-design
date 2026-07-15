import {
  BGN,
  Dinero,
  DineroCurrency,
  EUR,
  GBP,
  USD,
  add,
  dinero,
  equal,
  subtract,
  toSnapshot,
} from 'dinero.js';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
  UnknownCurrencyCodeError,
} from './money.errors';
import { Result, fail, ok } from './result';

/**
 * Deliberately curated, not dinero.js's full 150+ currency list — extend
 * as the business actually needs a new currency, not speculatively ahead
 * of that.
 */
const CURRENCIES_BY_CODE: Record<string, DineroCurrency<number>> = {
  USD,
  EUR,
  GBP,
  BGN,
};

export function currencyFromCode(code: string): DineroCurrency<number> | null {
  return CURRENCIES_BY_CODE[code.toUpperCase()] ?? null;
}

/**
 * Wraps `dinero.js` v2 (integer-safe currency math) behind a boundary that
 * never leaks `Dinero<number>` out — swapping the backing library later
 * only touches this file. Amounts are always integer minor units (cents),
 * never floats.
 */
export class Money {
  private constructor(private readonly inner: Dinero<number>) {}

  static fromMinorUnits(
    amount: number,
    currency: DineroCurrency<number>,
  ): Result<Money, InvalidMoneyAmountError> {
    if (!Number.isInteger(amount) || amount < 0) {
      return fail(new InvalidMoneyAmountError(amount));
    }
    return ok(new Money(dinero({ amount, currency })));
  }

  /** Convenience factory for the common case: a currency ISO code string (as stored in Firestore) instead of a full `DineroCurrency` object. */
  static fromMinorUnitsAndCode(
    amount: number,
    currencyCode: string,
  ): Result<Money, InvalidMoneyAmountError | UnknownCurrencyCodeError> {
    const currency = currencyFromCode(currencyCode);
    if (!currency) {
      return fail(new UnknownCurrencyCodeError(currencyCode));
    }
    return Money.fromMinorUnits(amount, currency);
  }

  add(other: Money): Result<Money, CurrencyMismatchError> {
    const mismatch = this.checkSameCurrency(other);
    if (mismatch) return fail(mismatch);
    return ok(new Money(add(this.inner, other.inner)));
  }

  subtract(other: Money): Result<Money, CurrencyMismatchError> {
    const mismatch = this.checkSameCurrency(other);
    if (mismatch) return fail(mismatch);
    return ok(new Money(subtract(this.inner, other.inner)));
  }

  equals(other: Money): boolean {
    return (
      this.currencyCode() === other.currencyCode() &&
      equal(this.inner, other.inner)
    );
  }

  toMinorUnits(): number {
    return toSnapshot(this.inner).amount;
  }

  currencyCode(): string {
    return toSnapshot(this.inner).currency.code;
  }

  private checkSameCurrency(other: Money): CurrencyMismatchError | null {
    const left = this.currencyCode();
    const right = other.currencyCode();
    return left === right ? null : new CurrencyMismatchError(left, right);
  }
}
