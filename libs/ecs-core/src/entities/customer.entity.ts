import type {
  CustomerOrigin,
  Email,
  E164,
  ErasureLifecycle,
  WriteProvenance,
} from '@core/components';
import type { CustomerId, UserId, UtcEpochMs } from '@core/primitives';

/**
 * `customers/{customerId}` — the shop's record of a person it serves (D29,
 * flatten-spec §5): whether or not that person has an account. `CustomerId`
 * (this record) and `UserId` (the auth account) are never the same value
 * and never assignable to each other; a customer MAY reference an account
 * through the explicit nullable `userId`, written at the boundary — never a
 * value derived from the `CustomerId` text, never the other way round.
 *
 * An account holder's record has the deterministic id
 * `CustomerId.forUser(uid, hash)`; a walk-in's
 * `CustomerId.forWalkIn(contactKey, keyedHash)` (OR-26, under the server's
 * key — the contact is personal data). Contact
 * here is the SHOP's copy (what the desk may edit); the account's sign-in
 * contact stays on `users/{uid}` (OQ-5). The document body is this type
 * minus `id`.
 *
 * Created by `CustomerRecordSystem.createsFor` in exactly two
 * transactions — a first booking or edit seating the account
 * (`FIRST_BOOKING`, booking flip (1)) and `completeRegistration`
 * (`REGISTRATION`, identity flip (2)) — and by
 * `CustomerRecordSystem.walkInCreates` (`STAFF_WALK_IN`, OR-26) in the staff
 * commit and edit, each only when its read found the record absent; the dev
 * seed writes `SEED` records. Never synchronised with later profile edits
 * (OQ-5).
 *
 * The record's identity slice — every plain 1-to-1 field of the archetype
 * {@link Customer} but its write provenance.
 */
export type CustomerMeta = {
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

/**
 * The archetype (Law 6): the record's fields, the operation id of the last
 * booking-verb, registration or privacy callable that wrote it
 * (`WriteProvenance`, WS-4.3 — RU-29), and where it stands with respect to
 * a data-subject erasure (`ErasureLifecycle` — `erasureStatus`, REQUIRED on
 * every body: every writer creates `NONE`, and every writer that would seat
 * or re-create the record reads it, audit-hardening Phase 3 WS-D, P3-L-18).
 * An erased record keeps its id, `userId`, `createdAtUtcMs` and
 * `customerOrigin` (visits and balances reference it); its name is the
 * language-neutral marker and its contact `null`. The document body is this
 * type minus `id`.
 */
export type Customer = CustomerMeta & WriteProvenance & ErasureLifecycle;
