import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { Result, fail, ok } from './result';
import { PhoneNumberInvalidError } from './phone-number.errors';

/**
 * E.164 phone number (`+<country><subscriber>`), validated via
 * `libphonenumber-js` — caged in `domain/kernel` behind this class the same
 * way `Money` cages `dinero.js`; nothing outside `domain/kernel` may import
 * `libphonenumber-js` directly (ESLint `no-restricted-imports`).
 */
export class PhoneNumber {
  private constructor(private readonly _e164: string) {}

  /**
   * Accepts either an already-E.164 string, or a local-format string plus
   * the ISO 3166-1 alpha-2 country to interpret it against.
   */
  static create(
    raw: string,
    defaultCountry?: CountryCode,
  ): Result<PhoneNumber, PhoneNumberInvalidError> {
    const cleaned = raw.trim();
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (!parsed?.isValid()) {
      return fail(new PhoneNumberInvalidError(raw));
    }
    return ok(new PhoneNumber(parsed.number));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with unvalidated input. */
  static fromPrimitive(trustedE164: string): PhoneNumber {
    return new PhoneNumber(trustedE164);
  }

  get value(): string {
    return this._e164;
  }

  equals(other: PhoneNumber): boolean {
    return this._e164 === other._e164;
  }

  toString(): string {
    return this._e164;
  }
}
