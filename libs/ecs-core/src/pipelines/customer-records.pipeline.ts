import { CustomerOrigin, WriteOp } from '@core/components';
import {
  CustomerId,
  RepositoryErrorCode,
  type Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type AccountContact,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import type { Hash, ReadTx } from '@core/ports';
import { SearchFieldsSystem } from '@core/systems';
import { customerPath } from './booking-read-set.pipeline';

/**
 * THE CLIENT RECORDS OF A BOOKING (D29, flip 1 F1-5) — a `ReadTx` helper
 * plus the plan entries, shared by `bookAppointment` and `editAppointment`.
 *
 * - **Ids, before any read.** Every account a booking seats has ONE client
 *   record at a deterministic path, `customers/{CustomerId.forUser(uid,
 *   hash)}` ({@link customerIdsFor}) — so the record rides the phase-one
 *   `getAll` of the booking read set (no extra round trip), and the
 *   decision is handed the ids, never a hash.
 * - **The contact snapshot, outside.** `firstName`, `lastName`, `phone`
 *   and `email` of `users/{uid}` come from `loadAccountContacts`, read
 *   BEFORE the transaction opens: `users/{uid}` never enters the conflict
 *   set, and a stale name in a first-booking copy is harmless.
 * - **Create only when absent in-tx** ({@link customerCreates}): a record
 *   the transaction read is never written; one it found absent is a
 *   `WriteOp.create` with `customerOrigin: FIRST_BOOKING`, the snapshot's
 *   name and channels, and the search keys `SearchFieldsSystem` derives.
 * - **A lost create race is NEVER success** ({@link runWithCustomerRetry}):
 *   a commit that answers ALREADY_EXISTS on a customer path wrote nothing of
 *   its plan (the Admin SDK retries only ABORTED), so the whole transaction
 *   is run ONCE more — it re-reads and finds the record — and a second
 *   failure is the answer.
 */

/** The client record of every account, keyed by the account — `CustomerId.forUser(uid, hash)`. */
export function customerIdsFor(
  userIds: readonly UserId[],
  hash: Hash,
): ReadonlyMap<UserId, CustomerId> {
  const ids = new Map<UserId, CustomerId>();
  for (const userId of userIds) {
    if (!ids.has(userId)) ids.set(userId, CustomerId.forUser(userId, hash));
  }
  return ids;
}

/** The distinct record ids of a resolution, in account order. */
export function customerIdsOf(
  resolved: ReadonlyMap<UserId, CustomerId>,
): readonly CustomerId[] {
  return [...new Set(resolved.values())];
}

/**
 * The records on their own — ONE `getAll` (absent ones read too), for a
 * caller that does not ride the booking read set's phase one.
 */
export async function readCustomers(
  tx: ReadTx,
  ids: readonly CustomerId[],
): Promise<ReadonlyMap<CustomerId, Customer | null>> {
  const distinct = [...new Set(ids)];
  const found = new Map<CustomerId, Customer | null>();
  if (distinct.length === 0) return found;
  const docs = await tx.getAll<Customer>(distinct.map(customerPath));
  for (const [i, id] of distinct.entries()) found.set(id, docs[i] ?? null);
  return found;
}

/** No snapshot for an account (its `users` document is gone): a nameless record, never a guess. */
const NO_CONTACT: AccountContact = {
  firstName: null,
  lastName: null,
  phone: null,
  email: null,
};

/**
 * The `Create`s of the records this transaction found ABSENT — one per
 * account, at its deterministic path; a record it read is left alone (a
 * booking never rewrites somebody's record). Not read at all (`undefined`
 * in `stored`) is not absent: nothing is planned for it.
 */
export function customerCreates(
  resolved: ReadonlyMap<UserId, CustomerId>,
  stored: ReadonlyMap<CustomerId, Customer | null>,
  contacts: ReadonlyMap<UserId, AccountContact>,
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
      customerOrigin: CustomerOrigin.FirstBooking,
    };
    writes.push(WriteOp.create(customerPath(customerId), body));
  }
  return writes;
}

const CUSTOMER_PATH_PREFIX = `${Collections.Customers}/`;

/** Is this answer a `Create` of a client record that met one already there? */
export function isCustomerConflict<T, E>(result: Result<T, E>): boolean {
  if (result.ok) return false;
  const error: unknown = result.error;
  if (typeof error !== 'object' || error === null) return false;
  const code = Object.getOwnPropertyDescriptor(error, 'errorCode')?.value;
  const path = Object.getOwnPropertyDescriptor(error, 'path')?.value;
  return (
    code === RepositoryErrorCode.AlreadyExists &&
    typeof path === 'string' &&
    path.startsWith(CUSTOMER_PATH_PREFIX)
  );
}

/**
 * Runs a booking transaction, and ONCE more when its customer `Create` lost
 * a race (ALREADY_EXISTS on a customer path): the re-run re-reads, finds
 * the record and plans no create. Whatever the second run answers is the
 * answer — a second conflict included, never mapped to success.
 */
export async function runWithCustomerRetry<T, E>(
  run: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  const first = await run();
  return isCustomerConflict(first) ? run() : first;
}
