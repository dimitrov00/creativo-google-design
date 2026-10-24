import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import type { UserId } from '@core/primitives';
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
 * `affectedKeys().hasOnly(['readAtUtcMs'])`), at the instant the caller's
 * injected clock gave. A notification is created only by the matcher's
 * server plan, never here.
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

    markNotificationRead: (userId, id, readAtUtcMs) =>
      attemptWrite(`${inboxPath(userId)}/${id}`, () =>
        updateDoc(
          doc(db, Collections.Users, userId, Subcollections.Notifications, id),
          { readAtUtcMs },
        ),
      ),
  };
};
