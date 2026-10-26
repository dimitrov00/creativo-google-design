import { UtcEpochMs, type NotificationId } from '@core/primitives';
import type { InboxNotification } from '@core/entities';

/*
 * ONE RECIPIENT'S INBOX (`notification.ts:120-148`, OR-19): read state lives
 * on the notification — "unread" is `readAtUtcMs === null`, the question
 * every badge asks — and a receipt never predates its message. The inbox
 * page stamps ONE receipt for every unread row on entry: the ids are
 * {@link NotificationSystem.unreadIds}, the instant
 * {@link NotificationSystem.receiptAt}, clamped at construction so it can
 * never fall before a message it reads (the rules hold the same line, and
 * let a receipt be written once). Stamps only (T4: no shop clock is needed
 * to stamp or order two instants).
 */

/** What the inbox reads of a notification: its receipt. */
export type NotificationReceipt = Pick<InboxNotification, 'readAtUtcMs'>;

/** What the inbox page's receipt reads of a notification: its id and its receipt. */
export type NotificationUnread = Pick<InboxNotification, 'id' | 'readAtUtcMs'>;

/** What the receipt's instant reads of an unread notification: when it was sent. */
export type NotificationSent = Pick<InboxNotification, 'sentAtUtcMs'>;

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

  /**
   * The ids of the unread ones, in the list's order — what the inbox page
   * snapshots on entry (its dots) and stamps with one receipt. Empty when
   * everything is read: no receipt is written then.
   */
  unreadIds(
    notifications: readonly NotificationUnread[],
  ): readonly NotificationId[] {
    const ids: NotificationId[] = [];
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i] as NotificationUnread;
      if (notification.readAtUtcMs === null) ids.push(notification.id);
    }
    return ids;
  },

  /**
   * The ONE instant a receipt for `unread` is stamped with: `nowUtcMs`, or
   * the newest of their `sentAtUtcMs` when the reader's clock runs behind
   * the writer's — a receipt never predates the message it reads (OR-19,
   * DEP-F14: clamped here, never refused after the fact). `nowUtcMs` when
   * there is nothing unread.
   */
  receiptAt(
    unread: readonly NotificationSent[],
    nowUtcMs: UtcEpochMs,
  ): UtcEpochMs {
    let at = nowUtcMs;
    for (let i = 0; i < unread.length; i++) {
      const sentAtUtcMs = (unread[i] as NotificationSent).sentAtUtcMs;
      if (UtcEpochMs.compare(sentAtUtcMs, at) > 0) at = sentAtUtcMs;
    }
    return at;
  },
} as const;
