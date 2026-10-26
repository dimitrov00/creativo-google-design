import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  writeBatch,
} from 'firebase/firestore';
import { Result, type UserId } from '@core/primitives';
import {
  Collections,
  type InboxNotification,
  Subcollections,
} from '@core/entities';
import type { InboxPorts } from '@core/ports';
import { attemptWrite, observeQuery } from './observe';

/** An inbox is a surface, not an archive: the newest this many. */
const INBOX_SIZE = 50;

/**
 * A person's inbox — `users/{uid}/notifications` (flip 1, plan §3.4), the
 * successor of `FirestoreNotificationReader`. Live, the newest 50 by
 * `sentAtUtcMs`; the owner may stamp only `readAtUtcMs` (the rules'
 * `affectedKeys().hasOnly(['readAtUtcMs'])`), once, never before the
 * message was sent. A notification is created only by the matcher's server
 * plan, never here.
 */
export const inboxPorts = (db: Firestore): InboxPorts => {
  const inboxPath = (userId: UserId): string =>
    `${Collections.Users}/${userId}/${Subcollections.Notifications}`;
  const inbox = (userId: UserId) =>
    collection(db, Collections.Users, userId, Subcollections.Notifications);

  return {
    observeInbox: (userId) =>
      observeQuery<InboxNotification>(
        query(inbox(userId), orderBy('sentAtUtcMs', 'desc'), limit(INBOX_SIZE)),
        inboxPath(userId),
      ),

    // THE READ RECEIPT (OR-19): ONE `writeBatch` of root `readAtUtcMs`
    // updates, every named notification at the same instant — the ids the
    // inbox page found unread, so at most the inbox's 50 (Firestore's batch
    // takes 500). All or nothing: a stamp the rules refuse (a second one,
    // one before its message) fails the batch, and nothing is written. No
    // ids, no commit.
    markNotificationsRead: (userId, ids, readAtUtcMs) => {
      if (ids.length === 0) return Promise.resolve(Result.ok(undefined));
      return attemptWrite(inboxPath(userId), () => {
        const batch = writeBatch(db);
        for (const id of ids) {
          batch.update(
            doc(
              db,
              Collections.Users,
              userId,
              Subcollections.Notifications,
              id,
            ),
            { readAtUtcMs },
          );
        }
        return batch.commit();
      });
    },
  };
};
