import {
  type Firestore,
  collection,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Collections, type WaitlistRequest } from '@core/entities';
import type { WaitlistReadPorts } from '@core/ports';
import { observeQuery } from './observe';

/**
 * `waitlistRequests/*`, read side (flip 1, plan §3.4) — the successor of
 * `FirestoreWaitlistReader.observeMine`. A person's standing requests,
 * live, newest first (index #17: `ownerUserId`, `createdAtUtcMs` desc); the
 * request is the ACCOUNT's (D29), the rules read key `ownerUserId`. Writes
 * go through the waitlist callables only.
 */
export const waitlistReadPorts = (db: Firestore): WaitlistReadPorts => ({
  observeMyWaitlistRequests: (ownerUserId) =>
    observeQuery<WaitlistRequest>(
      query(
        collection(db, Collections.WaitlistRequests),
        where('ownerUserId', '==', ownerUserId),
        orderBy('createdAtUtcMs', 'desc'),
      ),
      Collections.WaitlistRequests,
    ),
});
