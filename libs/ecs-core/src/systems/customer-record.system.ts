import { type CustomerOrigin, WriteOp } from '@core/components';
import type { CustomerId, UserId, UtcEpochMs } from '@core/primitives';
import {
  type AccountContact,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import { SearchFieldsSystem } from './search-fields.system';

/**
 * CustomerRecordSystem — the client RECORD an account gets (D29,
 * flatten-spec §5.3): the body and the create-when-absent decision, lifted
 * out of the booking pipelines' helper (flip 1, F1-5) so every transaction
 * that creates one — a first booking or edit (`FIRST_BOOKING`), a
 * registration (`REGISTRATION`, identity flip (2), F2-7b) — plans it the
 * same way. The pipelines resolve the ids (`CustomerId.forUser(uid, hash)`),
 * read the records inside their transaction and hand this system what they
 * read; it plans, it never reads.
 */

/** No contact for an account (its `users` document is gone): a nameless record, never a guess. */
const NO_CONTACT: AccountContact = {
  firstName: null,
  lastName: null,
  phone: null,
  email: null,
};

export const CustomerRecordSystem = {
  /**
   * The accounts whose record the transaction found ABSENT and for whom no
   * contact snapshot was read yet — in `resolved`'s order. The staff edit
   * reads their contacts OUTSIDE any transaction and runs again, so
   * {@link createsFor} never writes a nameless record for a contact it
   * could have read. A record never read (`undefined` in `stored`) is not
   * absent: nobody is asked for.
   */
  missingContacts(
    resolved: ReadonlyMap<UserId, CustomerId>,
    stored: ReadonlyMap<CustomerId, Customer | null>,
    contacts: ReadonlyMap<UserId, AccountContact>,
  ): readonly UserId[] {
    const missing: UserId[] = [];
    for (const [userId, customerId] of resolved) {
      if (stored.get(customerId) === null && !contacts.has(userId)) {
        missing.push(userId);
      }
    }
    return missing;
  },

  /**
   * The `Create`s of the records the transaction found ABSENT — one per
   * account, at its deterministic path `customers/{customerId}`; a record
   * it read is left alone (no writer ever rewrites somebody's record), and
   * one never read (`undefined` in `stored`) is not absent: nothing is
   * planned for it. Each body is the account's contact as given — the full
   * name as `displayName`, the phone and e-mail, the search keys
   * `SearchFieldsSystem` derives — the `origin` and `nowUtcMs` as its
   * `createdAtUtcMs`, and the explicit link `userId`.
   */
  createsFor(
    resolved: ReadonlyMap<UserId, CustomerId>,
    stored: ReadonlyMap<CustomerId, Customer | null>,
    contacts: ReadonlyMap<UserId, AccountContact>,
    origin: CustomerOrigin,
    nowUtcMs: UtcEpochMs,
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const planned = new Set<CustomerId>();
    for (const [userId, customerId] of resolved) {
      // Read and present (a record), or never read (`undefined`): no create.
      if (planned.has(customerId) || stored.get(customerId) !== null) continue;
      planned.add(customerId);
      const contact = contacts.get(userId) ?? NO_CONTACT;
      const body: Omit<Customer, 'id'> = {
        userId,
        displayName: Profile.fullName(contact),
        phone: contact.phone,
        email: contact.email,
        ...SearchFieldsSystem.searchFields(
          contact.firstName,
          contact.lastName,
          contact.phone,
          contact.email,
        ),
        createdAtUtcMs: nowUtcMs,
        customerOrigin: origin,
      };
      writes.push(WriteOp.create([Collections.Customers, customerId], body));
    }
    return writes;
  },
} as const;
