import {
  type Firestore,
  collection,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { Collections, type Customer } from '@core/entities';
import type { CustomerPorts } from '@core/ports';
import type { StoredDocument } from '@core/systems';
import { admitted, type ReadGuard, readQuery, UNGUARDED } from './observe';

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
 * raw, and a malformed record answers `REPOSITORY_MALFORMED` (reported) —
 * never read as "no record yet", which the client card would offer to
 * create over it. A bare `customerPorts(db)` guards nothing.
 */
export const customerPorts = (
  db: Firestore,
  guard: ReadGuard = UNGUARDED,
): CustomerPorts => ({
  loadCustomerForUser: async (userId) => {
    const found = await readQuery<StoredDocument>(
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
});
