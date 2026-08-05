import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, WriteBatch } from 'firebase-admin/firestore';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { Notification } from '@creativo/domain/notifications';

/**
 * Delivery-side metadata the DOMAIN deliberately does not model: which
 * waitlist request produced this message, and for which day. First-class
 * FIELDS so dedup can be an indexed equality — the earlier scheme identified
 * a request by substring-matching its id inside `deepLink` across an
 * unbounded time-window scan, which is a full-text search wearing a query's
 * clothes.
 */
export interface NotificationDeliveryMeta {
  readonly requestId?: string;
  readonly dayKey?: string;
}

/** The inbox lives under its recipient — it is never queried across users. */
export function notificationsCollection(uid: string): string {
  return `users/${uid}/notifications`;
}

export function notificationToDocument(
  notification: Notification,
  meta: NotificationDeliveryMeta = {},
): Record<string, unknown> {
  return {
    id: notification.id.value,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    sentAtIso: notification.sentAt.toISO(),
    readAtIso: notification.readAt?.toISO() ?? null,
    deepLink: notification.deepLink,
    // TTL mirror — an unread invitation to a slot that opened 90 days ago
    // is archaeology, not an inbox. Enable the policy on
    // `notifications.purgeAt` at deploy time; TTL deletes are unbilled.
    purgeAt: Timestamp.fromMillis(
      notification.sentAt.toMillis() + 90 * 24 * 3_600_000,
    ),
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(meta.dayKey ? { dayKey: meta.dayKey } : {}),
  };
}

/**
 * The delivery lane, such as it is: writes land in the recipient's own inbox.
 *
 * ### Why in-app and not push or email
 * There is no sender in this repo — `ConsoleLogOtpSender` is the only one, and
 * the design record lists "how does a waitlist match reach the user?" as open
 * precisely because adding a real channel means credentials, consent, an
 * unsubscribe path and a deliverability story, none of which exist yet. An
 * in-app notification is a real, honest delivery: the client observes this
 * collection live, so an open tab surfaces the match immediately and a closed
 * one finds it on next open.
 *
 * The seam for a second channel is this class, not the matcher: `Notification`
 * already documents channels as deliberately unmodelled, and a push adapter
 * would sit beside this one reading the same aggregate.
 */
export class FirestoreNotificationWriter {
  constructor(private readonly db: Firestore) {}

  async deliver(
    uid: string,
    notification: Notification,
    meta: NotificationDeliveryMeta = {},
  ): Promise<void> {
    await this.db
      .collection(notificationsCollection(uid))
      .doc(notification.id.value)
      .set(notificationToDocument(notification, meta));
  }

  /**
   * The same delivery, staged into a caller-owned batch — so the matcher can
   * land "the notification exists" and "the request is matched" as ONE
   * atomic write instead of two that a crash between could split.
   */
  deliverInto(
    batch: WriteBatch,
    uid: string,
    notification: Notification,
    meta: NotificationDeliveryMeta = {},
  ): void {
    batch.set(
      this.db
        .collection(notificationsCollection(uid))
        .doc(notification.id.value),
      notificationToDocument(notification, meta),
    );
  }

  /**
   * Has this recipient already been told about this request today?
   *
   * The matcher runs on every write to a barber's day, and a busy shop writes
   * many. Without this a single afternoon of rescheduling would send the same
   * person a dozen identical notifications — which is the fastest way to make
   * someone turn the whole feature off. The request's status moving to
   * `matched` is the primary guard; this is the belt to that brace, and it
   * survives a status update that failed after the notification was written.
   */
  async hasRecentFor(
    uid: string,
    requestId: string,
    since: ZonedDateTime,
  ): Promise<boolean> {
    // An indexed equality on the first-class `requestId` field + a limit(1)
    // existence probe — needs the `(kind, requestId, sentAtIso)` composite.
    // This replaces scanning every waitlist notification in the window and
    // substring-matching the id out of `deepLink`.
    const snapshot = await this.db
      .collection(notificationsCollection(uid))
      .where('kind', '==', 'waitlist_match')
      .where('requestId', '==', requestId)
      .where('sentAtIso', '>=', since.toISO())
      .limit(1)
      .get();

    return !snapshot.empty;
  }
}
