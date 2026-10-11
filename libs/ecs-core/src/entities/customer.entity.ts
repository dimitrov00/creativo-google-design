import type { CustomerOrigin } from '../components/customer-origin.data';
import type { Email } from '../components/email.data';
import type { E164 } from '../components/phone-number.data';
import type { CustomerId, UserId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * `customers/{customerId}` — the shop's record of a person it serves (D29,
 * flatten-spec §5): whether or not that person has an account. `CustomerId`
 * (this record) and `UserId` (the auth account) are never the same value
 * and never assignable to each other; a customer MAY reference an account
 * through the explicit nullable `userId`, written at the boundary — never a
 * value derived from the `CustomerId` text, never the other way round.
 *
 * An account holder's record has the deterministic id
 * `CustomerId.forUser(uid, hash)`; a walk-in's a random `cus_…` id. Contact
 * here is the SHOP's copy (what the desk may edit); the account's sign-in
 * contact stays on `users/{uid}` (OQ-5). The document body is this type
 * minus `id`.
 *
 * Vocabulary only in the flatten pass (§5.5): no shim reads or writes a
 * customer; the booking flip (1) creates them (`FIRST_BOOKING`), the
 * identity flip (2) at registration (`REGISTRATION`).
 */
export type Customer = {
  readonly id: CustomerId;
  /** The account this person signs in with; `null` for a walk-in the shop entered. */
  readonly userId: UserId | null;
  /** The name the shop calls them — the account's full name at link time, or what the desk typed. */
  readonly displayName: string;
  readonly phone: E164 | null;
  readonly email: Email | null;
  /** Lower-cased display name + prefixes, as on users (`SearchFieldsSystem`). */
  readonly searchName: string;
  readonly searchPrefixes: readonly string[];
  readonly createdAtUtcMs: UtcEpochMs;
  readonly customerOrigin: CustomerOrigin;
};
