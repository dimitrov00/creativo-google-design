import {
  CustomerId,
  RepositoryErrorCode,
  type Result,
  type UserId,
} from '@core/primitives';
import { Collections, type Customer } from '@core/entities';
import type { Hash, ReadTx } from '@core/ports';
import { customerPath } from './booking-read-set.pipeline';

/**
 * THE CLIENT RECORDS OF A TRANSACTION (D29, flip 1 F1-5, flip 2 F2-7b) — the
 * id resolution, a `ReadTx` helper and the create-race retry, shared by
 * `bookAppointment`, `editAppointment` and the identity pipelines.
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
 * - **Create only when absent in-tx** (`CustomerRecordSystem.createsFor`,
 *   the business half, `@core/systems`): a record the transaction read is
 *   never written; one it found absent is a `WriteOp.create` with the
 *   caller's `customerOrigin` (`FIRST_BOOKING` here, `REGISTRATION` in
 *   `completeRegistration`), the snapshot's name and channels, and the
 *   search keys `SearchFieldsSystem` derives.
 * - **A lost create race is NEVER success** ({@link runWithCreateRetry},
 *   {@link runWithCustomerRetry}): a commit that answers ALREADY_EXISTS on a
 *   listed collection wrote nothing of its plan (the Admin SDK retries only
 *   ABORTED), so the whole transaction is run ONCE more — it re-reads and
 *   finds the document — and a second failure is the answer. `verifyOtp`'s
 *   stub `Create` rides the same retry over `users`.
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

/**
 * Is this answer a commit-time `Create` that met a document already there
 * (`ALREADY_EXISTS`) in one of the listed collections? `collectionPrefixes`
 * are collection names (`Collections.Customers`, `Collections.Users`); the
 * error's `path` must start with `<collection>/`.
 */
export function isCreateConflict<T, E>(
  result: Result<T, E>,
  collectionPrefixes: readonly string[],
): boolean {
  if (result.ok) return false;
  const error: unknown = result.error;
  if (typeof error !== 'object' || error === null) return false;
  const code = Object.getOwnPropertyDescriptor(error, 'errorCode')?.value;
  const path = Object.getOwnPropertyDescriptor(error, 'path')?.value;
  if (code !== RepositoryErrorCode.AlreadyExists || typeof path !== 'string') {
    return false;
  }
  for (const collection of collectionPrefixes) {
    if (path.startsWith(`${collection}/`)) return true;
  }
  return false;
}

/**
 * Runs a transaction, and ONCE more when one of its `Create`s lost a race
 * (ALREADY_EXISTS on a listed collection — the Admin SDK retries only
 * ABORTED, so the commit wrote nothing of its plan): the re-run re-reads,
 * finds the winner's document and plans no create. Whatever the second run
 * answers is the answer — a second conflict included, never mapped to
 * success.
 */
export async function runWithCreateRetry<T, E>(
  run: () => Promise<Result<T, E>>,
  collectionPrefixes: readonly string[],
): Promise<Result<T, E>> {
  const first = await run();
  return isCreateConflict(first, collectionPrefixes) ? run() : first;
}

/** The customers specialisation — a booking, edit or registration whose client-record `Create` lost a race. */
export function runWithCustomerRetry<T, E>(
  run: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  return runWithCreateRetry(run, [Collections.Customers]);
}
