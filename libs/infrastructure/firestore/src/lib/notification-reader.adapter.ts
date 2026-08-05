import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { Notification, NotificationId } from '@creativo/domain/notifications';
import { UserId } from '@creativo/domain/accounts';
import type { NotificationReader } from '@creativo/application/notifications';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { subscribeWithRetry } from './subscribe-with-retry';

/** The inbox lives under its recipient — it is never queried across users. */
const NOTIFICATIONS = 'notifications';

/**
 * The tenant's zone.
 *
 * The instants stored are absolute, so this only decides how they READ. A
 * single-city tenant makes a constant honest; it becomes the viewer's own
 * preference the day a profile carries one.
 */
const ZONE = 'Europe/Sofia';

function toNotification(id: string, data: DocumentData): Notification | null {
  const sentAt = ZonedDateTime.fromISO(String(data['sentAtIso'] ?? ''), ZONE);
  if (sentAt.isFailure()) return null;

  const rawRead = data['readAtIso'];
  const readAt =
    rawRead == null ? null : ZonedDateTime.fromISO(String(rawRead), ZONE);
  if (readAt !== null && readAt.isFailure()) return null;

  const result = Notification.reconstitute({
    id,
    kind: data['kind'],
    title: String(data['title'] ?? ''),
    body: data['body'] == null ? undefined : String(data['body']),
    sentAt: sentAt.value,
    readAt: readAt === null ? null : readAt.value,
    deepLink: data['deepLink'] == null ? null : String(data['deepLink']),
  });
  // A malformed notification is DROPPED rather than failing the inbox: losing
  // one message beats an empty screen where a badge says three.
  return result.isSuccess() ? result.value : null;
}

/**
 * The recipient's own inbox, live.
 *
 * This is the client half of the waitlist's delivery lane: the matcher writes
 * a `waitlist_match` notification here, and because this is a snapshot
 * listener rather than a fetch, an open tab surfaces it within a second of the
 * slot opening up. That is what makes "we'll tell you" a real promise without
 * a push credential, an unsubscribe flow or a deliverability story — the three
 * things the design record flags as unresolved for a second channel.
 *
 * Replaces `InMemoryNotificationReader`, which was a declared stub: with it in
 * place a delivered match was written to a collection nothing read.
 */
@Injectable()
export class FirestoreNotificationReader implements NotificationReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  list(
    userId: UserId,
  ): Observable<Result<readonly Notification[], RepositoryError>> {
    return subscribeWithRetry<readonly Notification[]>((next, error) =>
      onSnapshot(
        // The newest 50: an inbox is a surface, not an archive. Nothing
        // deletes notifications yet, so an unbounded listener re-billed a
        // lifetime of them on every mount and grew without ceiling.
        query(this.inbox(userId), orderBy('sentAtIso', 'desc'), limit(50)),
        (snapshot) =>
          next(
            snapshot.docs
              .map((entry) => toNotification(entry.id, entry.data()))
              .filter((entry): entry is Notification => entry !== null),
          ),
        error,
      ),
    );
  }

  async markRead(
    userId: UserId,
    id: NotificationId,
  ): Promise<Result<void, RepositoryError>> {
    await updateDoc(doc(this.inbox(userId), id.value), {
      readAtIso: nowIso(),
    });
    return ok(undefined);
  }

  /**
   * Receipt for everything currently delivered.
   *
   * A batch rather than N awaited writes: clearing a badge is one gesture, and
   * a partial clear that failed halfway leaves a count nobody can explain.
   */
  async markAllRead(userId: UserId): Promise<Result<void, RepositoryError>> {
    // Query the UNREAD, not the whole inbox: reading everything to skip the
    // already-read rows billed the full history for a receipt, and a batch
    // holds at most 500 writes — one busy year of notifications would have
    // thrown. Chunked so the cap is honoured however large the backlog.
    const readAtIso = nowIso();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const unread = await getDocs(
        query(this.inbox(userId), where('readAtIso', '==', null), limit(400)),
      );
      if (unread.empty) return ok(undefined);
      const batch = writeBatch(this.db);
      for (const entry of unread.docs) {
        batch.update(entry.ref, { readAtIso });
      }
      await batch.commit();
      if (unread.size < 400) return ok(undefined);
    }
  }

  private inbox(userId: UserId) {
    return collection(this.db, 'users', userId.value, NOTIFICATIONS);
  }
}

/**
 * The receipt's timestamp.
 *
 * `Date` directly rather than the clock port: this value is written and never
 * reasoned about, and a read receipt is the one place where "the moment the
 * user tapped" genuinely is wall-clock now.
 */
function nowIso(): string {
  return new Date().toISOString();
}
