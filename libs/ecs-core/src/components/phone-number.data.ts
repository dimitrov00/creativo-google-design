import type { E164 } from './e164.data';

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
