import {
  type Brand,
  PrimitiveError,
  PrimitiveErrorCode,
  Result,
} from '@core/primitives';

/**
 * The E.164 shape: `+`, a country code that never starts with `0`, and 7 to
 * 15 digits in all — the ITU's ceiling. A SHAPE, not a number plan: whether
 * the digits name a real line is `PhoneSystem.parse`'s question (and
 * libphonenumber-js stays inside that one system).
 */
const E164_SHAPE = /^\+[1-9]\d{6,14}$/;

/**
 * A canonical E.164 phone number (`+<country><subscriber>`, digits only) —
 * the **stored** shape: `users.phone`, `BookingContact.phone`,
 * `otps.destination`. A brand over the plain string, so
 * `where('phone', '==', value)` and the users rules see one scalar.
 */
export type E164 = Brand<string, 'E164'>;

export const E164 = {
  /**
   * FOREIGN input that claims to be canonical already (OR-48) — the booking
   * draft rehydrated from browser storage, the landing's static display
   * number stripped to `+` and digits: the E.164 shape (see `E164_SHAPE`),
   * kept exactly as given, or `PRIMITIVE_PHONE_NOT_E164`. Typed user input
   * goes through `PhoneSystem.parse`, which knows the number plans.
   */
  parse(raw: string): Result<E164, PrimitiveError> {
    return E164.is(raw)
      ? Result.ok(raw)
      : Result.err(
          PrimitiveError.of(PrimitiveErrorCode.PhoneNotE164, raw, 'E164'),
        );
  },

  /**
   * The read-time door and the ONE home of the shape rule, which
   * {@link parse} answers through; `false` for every other value. No
   * `Result`, no allocation.
   */
  is(raw: unknown): raw is E164 {
    return typeof raw === 'string' && E164_SHAPE.test(raw);
  },

  /**
   * Proven values only — the only unchecked cast: `PhoneSystem.parse`'s
   * E.164 answer, a phone a document already stored, a fixture literal.
   * Never raw or rehydrated input: that is {@link parse}.
   */
  of: (raw: string): E164 => raw as E164,

  /** Canonical form makes equality plain string equality. */
  equals(a: E164, b: E164): boolean {
    return a === b;
  },
} as const;
