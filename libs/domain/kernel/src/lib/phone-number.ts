import {
  ParseError,
  parsePhoneNumberFromString,
  parsePhoneNumberWithError,
  validatePhoneNumberLength,
  type CountryCode,
  type PhoneNumber as ParsedPhoneNumber,
} from 'libphonenumber-js';
import { Result, fail, ok } from './result';
import { CountryIso2 } from './phone-country';
import {
  PhoneNumberInvalidError,
  PhoneNumberInvalidReason,
} from './phone-number.errors';

/**
 * Maps the library's diagnosis codes (`ParseError.message` and
 * `validatePhoneNumberLength` results share the same vocabulary) onto the
 * kernel's stable reason union.
 */
const INVALID_REASONS: Readonly<Record<string, PhoneNumberInvalidReason>> = {
  NOT_A_NUMBER: 'not-a-number',
  TOO_SHORT: 'too-short',
  TOO_LONG: 'too-long',
  INVALID_COUNTRY: 'invalid-country',
};

/**
 * E.164 phone number (`+<country><subscriber>`), validated via
 * `libphonenumber-js` — caged in `domain/kernel` behind this class the same
 * way `Money` cages `dinero.js`; nothing outside `domain/kernel` may import
 * `libphonenumber-js` directly (ESLint `no-restricted-imports`). Country
 * input rides the branded `CountryIso2`, never the library's `CountryCode`.
 *
 * Validation runs on the `min` metadata bundle (root import) on purpose:
 * per-country length checks catch virtually all typos, landlines stay
 * legitimate, and `max`'s digit-pattern strictness would start rejecting
 * freshly-assigned ranges as the metadata ages. OTP delivery is the real
 * reachability validator.
 */
export class PhoneNumber {
  private constructor(private readonly _e164: string) {}

  /**
   * Accepts either an already-E.164 string, or a local-format string plus
   * the ISO 3166-1 alpha-2 country to interpret it against.
   */
  static create(
    raw: string,
    defaultCountry?: CountryIso2,
  ): Result<PhoneNumber, PhoneNumberInvalidError> {
    const cleaned = raw.trim();
    const country = defaultCountry as CountryCode | undefined;
    try {
      const parsed = parsePhoneNumberWithError(cleaned, country);
      if (!parsed.isValid()) {
        // Parsing succeeded but validation didn't — ask the length
        // checker for a more specific diagnosis (too short/too long).
        const lengthProblem = validatePhoneNumberLength(cleaned, country);
        return fail(
          new PhoneNumberInvalidError(
            raw,
            (lengthProblem && INVALID_REASONS[lengthProblem]) ?? 'invalid',
          ),
        );
      }
      return ok(new PhoneNumber(parsed.number));
    } catch (error) {
      if (error instanceof ParseError) {
        return fail(
          new PhoneNumberInvalidError(
            raw,
            INVALID_REASONS[error.message] ?? 'invalid',
          ),
        );
      }
      throw error;
    }
  }

  /** Rebuild from persistence that was validated on the way in. Never call with unvalidated input. */
  static fromPrimitive(trustedE164: string): PhoneNumber {
    return new PhoneNumber(trustedE164);
  }

  get value(): string {
    return this._e164;
  }

  /** ISO 3166-1 alpha-2 derived from the E.164 calling code, e.g. `'BG'`. */
  get country(): CountryIso2 | undefined {
    return this.parsed()?.country as string | undefined as
      CountryIso2 | undefined;
  }

  /** Presentation only, e.g. `'088 555 0100'` — storage stays E.164. */
  formatNational(): string {
    return this.parsed()?.formatNational() ?? this._e164;
  }

  /** Presentation only, e.g. `'+359 88 555 0100'` — storage stays E.164. */
  formatInternational(): string {
    return this.parsed()?.formatInternational() ?? this._e164;
  }

  equals(other: PhoneNumber): boolean {
    return this._e164 === other._e164;
  }

  toString(): string {
    return this._e164;
  }

  /**
   * Re-parse the stored E.164 for derived views. Always succeeds for
   * values that went through `create`; the formatters above fall back to
   * the raw E.164 for `fromPrimitive` values the metadata can't place.
   */
  private parsed(): ParsedPhoneNumber | undefined {
    return parsePhoneNumberFromString(this._e164);
  }
}
