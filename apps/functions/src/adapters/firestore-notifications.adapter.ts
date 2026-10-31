import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { Collections, Subcollections } from '@core/entities';
import type { RecentNotificationPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The inbox's one server read (flip 1, blueprint §4.1 `matchWaitlist`): the
 * cross-day cooldown probe — has this person already been told about this
 * request since `sinceUtcMs`? `notificationTopic ==` ∧ `waitlistRequestId ==`
 * ∧ `sentAtUtcMs >=`, `limit 1` on `users/{uid}/notifications` (index #15).
 * A notification is CREATED only inside the matcher's `CommitPlan` (its TTL
 * stamped there, F1-7), never here. A read that throws answers a
 * `RepositoryError` value whose `reason` is the failure's canonical code.
 */

export const firestoreNotificationPorts = (
  db: Firestore,
): RecentNotificationPorts => ({
  hasRecentNotification: async (
    userId,
    topic,
    waitlistRequestId,
    sinceUtcMs,
  ) => {
    const path = `${Collections.Users}/${userId}/${Subcollections.Notifications}`;
    try {
      const snap = await db
        .collection(path)
        .where('notificationTopic', '==', topic)
        .where('waitlistRequestId', '==', waitlistRequestId)
        .where('sentAtUtcMs', '>=', sinceUtcMs)
        .limit(1)
        .get();
      return Result.ok(!snap.empty);
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
  },
});
