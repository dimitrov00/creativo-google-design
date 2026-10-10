import { EngagementError } from '../components/engagement-errors.data';
import type { NotificationEntity } from '../entities/notification.entity';

/*
 * ONE RECIPIENT'S INBOX (`notification.ts:120-148`): read state lives on
 * the notification — "unread" is `readAtMs === null`, the question every
 * badge asks — and a receipt never predates its message. `markRead`
 * returns a new struct; a notification already read is handed back as it
 * is, so marking twice never moves the receipt.
 */

/** What the inbox reads of a notification: its receipt. */
export type NotificationReceipt = Pick<NotificationEntity, 'readAtMs'>;

export const NotificationSystem = {
  isUnread(notification: NotificationReceipt): boolean {
    return notification.readAtMs === null;
  },

  /** How many of these are unread — the number every badge renders. */
  unreadCount(notifications: readonly NotificationReceipt[]): number {
    let count = 0;
    for (let i = 0; i < notifications.length; i++) {
      if ((notifications[i] as NotificationReceipt).readAtMs === null) {
        count += 1;
      }
    }
    return count;
  },

  /** Read at `atMs`: a new struct; an already-read notification is returned as it is. */
  markRead<N extends NotificationReceipt>(notification: N, atMs: number): N {
    return notification.readAtMs !== null
      ? notification
      : { ...notification, readAtMs: atMs };
  },

  /**
   * A receipt that predates its own message — clock skew between writer
   * and reader is real, and such a receipt is a bug worth surfacing, not
   * rounding. `null` when the receipt holds (or there is none).
   */
  readBeforeSent(
    notification: Pick<NotificationEntity, 'sentAtMs' | 'readAtMs'>,
  ): EngagementError.NotificationReadBeforeSent | null {
    const { sentAtMs, readAtMs } = notification;
    return readAtMs !== null && readAtMs < sentAtMs
      ? EngagementError.notificationReadBeforeSent(sentAtMs, readAtMs)
      : null;
  },
} as const;
