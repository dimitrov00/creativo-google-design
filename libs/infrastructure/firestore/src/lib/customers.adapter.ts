import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Collections, type Customer } from '@core/entities';
import type { CustomerReadPorts, CustomerSearchPorts } from '@core/ports';
import {
  admitted,
  type ReadGuard,
  readDoc,
  readQuery,
  readRawQuery,
} from './observe';

/**
 * `customers/*`, read side (D29, flip 1, plan §3.4) — the client RECORD of
 * an account. The browser holds no hash to derive `CustomerId.forUser`, so
 * it asks by the link field instead: `userId ==`, `limit 1`, on the
 * automatic single-field index (flatten-spec §5.5). `null` while the
 * account has no record yet (the booking pipeline creates it on the first
 * booking, `FIRST_BOOKING`). The web never writes a customer in this flip.
 *
 * Built with a {@link ReadGuard} (the composition root's `guardedReads`),
 * the one row answers the SINGLE rule (edge hardening D-3): the query reads
 * raw (`readRawQuery`), and a malformed record answers
 * `REPOSITORY_MALFORMED` (reported) — never read as "no record yet", which
 * the client card would offer to create over it. The guard is REQUIRED
 * (OR-33, DEP-F24): a bare `customerPorts(db)` does not type-check.
 *
 * `loadCustomer` reads ONE record by its id (`customers/{id}`, the staff
 * read `worksTheBook()` admits) — the card of a walk-in with no account
 * (S-WS-F): the same guard, the same SINGLE rule (a malformed record
 * answers `REPOSITORY_MALFORMED`, reported), `null` when absent.
 */
export const customerPorts = (
  db: Firestore,
  guard: ReadGuard,
): CustomerReadPorts => ({
  loadCustomerForUser: async (userId) => {
    const found = await readRawQuery(
      query(
        collection(db, Collections.Customers),
        where('userId', '==', userId),
        limit(1),
      ),
      Collections.Customers,
    );
    return found.ok
      ? admitted<Customer>(found.value[0] ?? null, Collections.Customers, guard)
      : found;
  },
  loadCustomer: (customerId) =>
    readDoc<Customer>(doc(db, Collections.Customers, customerId), guard),
});

/**
 * The staff client search over the client RECORDS (OR-26) — `customers`
 * where `searchPrefixes array-contains prefix`, `orderBy searchName`, at
 * most `limit` (the composite index `customers (searchPrefixes CONTAINS,
 * searchName ASC)` in `firestore.indexes.json`, deployed before the web).
 * `prefix` is already normalised (`SearchFieldsSystem.normalizeQuery`), as
 * for the account search (`userSearchPorts`), whose answers the client book
 * merges these with — so a walk-in the desk entered, a record with no
 * account (`userId: null`), is found again.
 *
 * Built with a {@link ReadGuard} — REQUIRED (OR-33, DEP-F24) — the rows
 * answer the LIST rule (edge hardening D-3): a malformed record is dropped
 * and reported, the rest answered — one bad record never blanks a search.
 */
export const customerSearchPorts = (
  db: Firestore,
  guard: ReadGuard,
): CustomerSearchPorts => ({
  searchCustomers: (prefix, count) =>
    readQuery<Customer>(
      query(
        collection(db, Collections.Customers),
        where('searchPrefixes', 'array-contains', prefix),
        orderBy('searchName'),
        limit(count),
      ),
      Collections.Customers,
      guard,
    ),
});
