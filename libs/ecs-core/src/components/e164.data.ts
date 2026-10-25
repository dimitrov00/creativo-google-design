import type { Brand } from '@core/primitives';

/**
 * A canonical E.164 phone number (`+<country><subscriber>`, digits only) —
 * the **stored** shape: `users.phone`, `BookingContact.phone`,
 * `otps.destination`. A brand over the plain string, so
 * `where('phone', '==', value)` and the users rules see one scalar.
 */
export type E164 = Brand<string, 'E164'>;

export const E164 = {
  /**
   * The only cast site — after `PhoneSystem.parse` at the edge, or on the
   * shop's own static display number stripped to `+` and digits (the
   * landing's `phoneHref`, which keeps libphonenumber-js out of its chunk);
   * never on raw user input.
   */
  of: (raw: string): E164 => raw as E164,

  /** Canonical form makes equality plain string equality. */
  equals(a: E164, b: E164): boolean {
    return a === b;
  },
} as const;
