import { Result, currencyFromCode, fail, ok } from '@creativo/domain/kernel';
import { UnknownCurrencyCodeError } from './currency-code.errors';

/**
 * A tenant's billing currency. Delegates the actual "is this a real,
 * supported currency" check to kernel's curated `currencyFromCode`
 * (the same short list `Money` validates against) rather than owning a
 * second currency vocabulary — but never leaks kernel's `dinero.js`
 * `DineroCurrency` type out; this class stores only the normalized ISO
 * code string, same boundary discipline as `Email`/`PhoneNumber`.
 */
export class CurrencyCode {
  private constructor(private readonly _value: string) {}

  static create(raw: string): Result<CurrencyCode, UnknownCurrencyCodeError> {
    const code = raw.trim().toUpperCase();
    if (!currencyFromCode(code)) {
      return fail(new UnknownCurrencyCodeError(raw));
    }
    return ok(new CurrencyCode(code));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with unvalidated input. */
  static fromPrimitive(trusted: string): CurrencyCode {
    return new CurrencyCode(trusted.toUpperCase());
  }

  get value(): string {
    return this._value;
  }

  equals(other: CurrencyCode): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
