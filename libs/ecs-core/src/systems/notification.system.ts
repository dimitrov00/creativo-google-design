import { EngagementError, UtcEpochMs } from '@core/primitives';
import type { InboxNotification } from '@core/entities';

/*
 * ONE RECIPIENT'S INBOX (`notification.ts:120-148`): read state lives on
 * the notification — "unread" is `readAtUtcMs === null`, the question
 * every badge asks — and a receipt never predates its message. `markRead`
 * returns a new struct; a notification already read is handed back as it
 * is, so marking twice never moves the receipt. Stamps only (T4: no shop
 * clock is needed to stamp or order two instants).
 */

/** What the inbox reads of a notification: its receipt. */
export type NotificationReceipt = Pick<InboxNotification, 'readAtUtcMs'>;

export const NotificationSystem = {
  isUnread(notification: NotificationReceipt): boolean {
    return notification.readAtUtcMs === null;
  },

  /** How many of these are unread — the number every badge renders. */
  unreadCount(notifications: readonly NotificationReceipt[]): number {
    let count = 0;
    for (let i = 0; i < notifications.length; i++) {
      if ((notifications[i] as NotificationReceipt).readAtUtcMs === null) {
        count += 1;
      }
    }
    return count;
  },

  /** Read at `atUtcMs`: a new struct; an already-read notification is returned as it is. */
  markRead<N extends NotificationReceipt>(
    notification: N,
    atUtcMs: UtcEpochMs,
  ): N {
    return notification.readAtUtcMs !== null
      ? notification
      : { ...notification, readAtUtcMs: atUtcMs };
  },

  /**
   * A receipt that predates its own message — clock skew between writer
   * and reader is real, and such a receipt is a bug worth surfacing, not
   * rounding. `null` when the receipt holds (or there is none).
   */
  readBeforeSent(
    notification: Pick<InboxNotification, 'sentAtUtcMs' | 'readAtUtcMs'>,
  ): EngagementError.NotificationReadBeforeSent | null {
    const { sentAtUtcMs, readAtUtcMs } = notification;
    return readAtUtcMs !== null &&
      UtcEpochMs.compare(readAtUtcMs, sentAtUtcMs) < 0
      ? EngagementError.notificationReadBeforeSent(sentAtUtcMs, readAtUtcMs)
      : null;
  },
} as const;
