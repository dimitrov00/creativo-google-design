import type { Firestore } from 'firebase-admin/firestore';
import { Result, WaitlistStatus } from '@core/primitives';
import { Collections, type WaitlistRequest } from '@core/entities';
import type { OpenWaitlistReadPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The waitlist's server read outside any transaction (flip 1, blueprint
 * §4.1 `matchWaitlist`): `loadOpenWaitlist` — every request still `OPEN`
 * that names the day, `waitlistStatus ==` ∧ `localDates array-contains`
 * (index #14). The single-request read `loadWaitlistRequest` had no caller
 * and is gone (OR-28): the cancel callable reads its request inside its
 * plan.
 *
 * Requests are CREATED and moved only inside a `CommitPlan` (the request and
 * cancel callables, the matcher's plan), never here. Bodies spread as stored;
 * a read that throws answers a `RepositoryError` value whose `reason` is the
 * failure's canonical code.
 */

export const firestoreWaitlistPorts = (
  db: Firestore,
): OpenWaitlistReadPorts => ({
  loadOpenWaitlist: async (localDate) => {
    try {
      const snap = await db
        .collection(Collections.WaitlistRequests)
        .where('waitlistStatus', '==', WaitlistStatus.Open)
        .where('localDates', 'array-contains', localDate)
        .get();
      return Result.ok(
        snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as WaitlistRequest,
        ),
      );
    } catch (error) {
      return Result.err(readFailed(Collections.WaitlistRequests, error));
    }
  },
});
