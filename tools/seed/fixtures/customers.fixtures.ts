/**
 * THE DEV SEED'S CLIENT RECORDS (D29, flip 1): one `customers/{customerId}`
 * per seeded account, `customerOrigin: 'SEED'` (flatten-spec §5.3) — the
 * shop's own copy of the person's name and contact, beside the account's
 * sign-in profile on `users/{uid}` (flip 2's).
 *
 * An account holder's record id is DERIVED, never cast:
 * `CustomerId.forUser(uid, hash)` with the production hash (sha256 hex,
 * restated here because the seed may not import an app — the same bytes as
 * `apps/functions/src/adapters/crypto.adapter.ts` `sha256Hex`), so the
 * booking pipeline's FIRST_BOOKING path finds the seeded record at the very
 * id it would have created, and the appointments, grants, vouchers, photos
 * and stats the seed writes name the same record.
 */
import { createHash } from 'node:crypto';
import { CustomerOrigin, Email } from '@core/components';
import { type Customer, Profile } from '@core/entities';
import { CustomerId, UserId, type UtcEpochMs } from '@core/primitives';
import { PhoneSystem, SearchFieldsSystem } from '@core/systems';
import { type Body, present, sure } from './catalog.fixtures';

/** The `hash` port's production function: sha256 of the UTF-8 input, lower-case hex. */
export const seedHash = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/** An account holder's client record id — `cus_…`, derived as the pipelines derive it. */
export function customerIdOf(uid: string): CustomerId {
  return CustomerId.forUser(UserId.of(uid), seedHash);
}

/** What the seed knows about a client: the profile it registered with. */
export type SeedClientContact = {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly email: string | null;
};

/**
 * `customers/{customerIdOf(uid)}` for a seeded account: the display name the
 * shop calls them, their contact as the desk's copy, the search keys
 * `SearchFieldsSystem` derives (as the booking's FIRST_BOOKING create does),
 * created at `createdAtUtcMs`.
 */
export function seededCustomerBody(
  uid: string,
  contact: SeedClientContact,
  createdAtUtcMs: UtcEpochMs,
): Body<Customer> {
  const phone = sure(
    PhoneSystem.parse(contact.phone, null),
    `phone ${contact.phone}`,
  ).e164;
  const email =
    contact.email === null
      ? null
      : present(Email.parse(contact.email), `email ${contact.email}`);
  return {
    userId: UserId.of(uid),
    displayName: Profile.fullName(contact),
    phone,
    email,
    ...SearchFieldsSystem.searchFields(
      contact.firstName,
      contact.lastName,
      phone,
      email,
    ),
    createdAtUtcMs,
    customerOrigin: CustomerOrigin.Seed,
  } satisfies Omit<Customer, 'id'>;
}
