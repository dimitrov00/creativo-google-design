import {
  type Firestore,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Result, type UserId } from '@core/primitives';
import {
  Collections,
  type InboxNotification,
  Subcollections,
} from '@core/entities';
import type { InboxPorts } from '@core/ports';
import { attemptWrite, observeQuery, writeFailed } from './observe';

/** An inbox is a surface, not an archive: the newest this many. */
const INBOX_SIZE = 50;

/** Unread notifications receipted per batch — well under a batch's write cap. */
const RECEIPT_BATCH = 400;

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

    /**
     * A receipt for everything delivered: the UNREAD only
     * (`readAtUtcMs == null`), a batch per 400, until a short batch says
     * nothing is left — one gesture, never a full-history read.
     */
    markAllNotificationsRead: async (userId, readAtUtcMs) => {
      try {
        for (;;) {
          const unread = await getDocs(
            query(
              inbox(userId),
              where('readAtUtcMs', '==', null),
              limit(RECEIPT_BATCH),
            ),
          );
          if (unread.empty) return Result.ok(undefined);
          const batch = writeBatch(db);
          for (const entry of unread.docs) {
            batch.update(entry.ref, { readAtUtcMs });
          }
          await batch.commit();
          if (unread.size < RECEIPT_BATCH) return Result.ok(undefined);
        }
      } catch (cause) {
        return Result.err(writeFailed(inboxPath(userId), cause));
      }
    },
  };
};
