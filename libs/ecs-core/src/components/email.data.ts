import type { Brand } from '@core/primitives';
/**
 * Shape check: one `@`, a non-empty local part, a dotted domain whose last
 * label has at least two characters, no whitespace anywhere. The accounts
 * and identity pattern (the models copy's looser `[^\s@]+` TLD retired with
 * it). OTP delivery is the real reachability validator.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * An e-mail address — trimmed, lower-cased, a brand over the plain stored
 * string (`users.email`, `BookingContact.email`, `otps.destination`), so
 * `where('email', '==', value)` sees one scalar and no `{ value }` wrapper
 * exists. The accounts, identity and models `Email` classes collapsed into
 * one (blueprint §2.4).
 */
export type Email = Brand<string, 'Email'>;

export const Email = {
  /** The only cast site — for a value already canonical (read back from a document). */
  of: (raw: string): Email => raw as Email,

  /**
   * The edge guard: trim, lower-case, check the shape — the canonical
   * `Email`, or `null`. Context-free on purpose: identity words a refusal as
   * `IDENTITY_IDENTIFIER_INVALID`, the booking contact as
   * `SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL`, accounts as
   * `ACCOUNTS_EMAIL_INVALID` — one rule, each edge its own code.
   */
  parse(raw: string): Email | null {
    const cleaned = raw.trim().toLowerCase();
    return EMAIL_PATTERN.test(cleaned) ? Email.of(cleaned) : null;
  },

  /** Canonical form makes equality plain string equality. */
  equals(a: Email, b: Email): boolean {
    return a === b;
  },
} as const;
