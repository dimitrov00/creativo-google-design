import type { Brand } from '../primitives/brand';
/**
 * A canonical E.164 phone number (`+<country><subscriber>`, digits only) —
 * the **stored** shape: `users.phone`, `BookingContact.phone`,
 * `otps.destination`. A brand over the plain string, so
 * `where('phone', '==', value)` and the users rules see one scalar.
 */
export type E164 = Brand<string, 'E164'>;

export const E164 = {
  /** The only cast site — after `PhoneSystem.parse` at the edge, never on raw input. */
  of: (raw: string): E164 => raw as E164,

  /** Canonical form makes equality plain string equality. */
  equals(a: E164, b: E164): boolean {
    return a === b;
  },
} as const;

/**
 * The **in-memory** result of `PhoneSystem.parse` at the edge — never stored:
 * `countryCallingCode` (digits only, e.g. `'359'`) is derivable from the
 * E.164 prefix, on demand, by `PhoneSystem.callingCode(e164)`.
 */
export type PhoneNumber = {
  readonly e164: E164;
  readonly countryCallingCode: string;
};

export const PhoneNumber = {
  /** By canonical E.164 — `'+359885550100'` parsed from either spelling is one number. */
  equals(a: PhoneNumber, b: PhoneNumber): boolean {
    return a.e164 === b.e164;
  },
} as const;
