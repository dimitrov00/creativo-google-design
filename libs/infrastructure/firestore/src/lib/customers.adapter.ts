import {
  type Firestore,
  collection,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { Result } from '@core/primitives';
import { Collections, type Customer } from '@core/entities';
import type { CustomerPorts } from '@core/ports';
import { readQuery } from './observe';

/**
 * `customers/*`, read side (D29, flip 1, plan §3.4) — the client RECORD of
 * an account. The browser holds no hash to derive `CustomerId.forUser`, so
 * it asks by the link field instead: `userId ==`, `limit 1`, on the
 * automatic single-field index (flatten-spec §5.5). `null` while the
 * account has no record yet (the booking pipeline creates it on the first
 * booking, `FIRST_BOOKING`). The web never writes a customer in this flip.
 */
export const customerPorts = (db: Firestore): CustomerPorts => ({
  loadCustomerForUser: async (userId) => {
    const found = await readQuery<Customer>(
      query(
        collection(db, Collections.Customers),
        where('userId', '==', userId),
        limit(1),
      ),
      Collections.Customers,
    );
    return found.ok ? Result.ok(found.value[0] ?? null) : found;
  },
});
