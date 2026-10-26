import type { Observable } from 'rxjs';
import type { NotificationTopic } from '@core/components';
import type {
  Result,
  NotificationId,
  UserId,
  WaitlistRequestId,
  UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { InboxNotification } from '@core/entities';

/**
 * A person's inbox — `users/{uid}/notifications`, the one owner-scoped
 * subcollection (blueprint §3.1, §4.2): payload facts, never formatted
 * words (§9 D20). The inbox is the ACCOUNT's, keyed by `UserId` for good
 * (D29). The owner may set the read stamp only, and only once; a
 * notification is CREATED only inside the matcher's `CommitPlan`, never
 * through a port.
 */

/** The newest 50 notifications, live — `orderBy sentAtUtcMs desc limit 50`, single-field. */
export type ObserveInbox = (
  userId: UserId,
) => Observable<Result<readonly InboxNotification[], RepositoryError>>;

/**
 * The inbox's read receipt (OR-19) — ONE `writeBatch` of root `readAtUtcMs`
 * updates, every named notification stamped at the same `readAtUtcMs`, at
 * most the inbox's 50. One-shot: the caller names the unread ids only
 * (`NotificationSystem.unreadIds`) at an instant never before the newest of
 * them was sent (`NotificationSystem.receiptAt`), and the rules refuse a
 * second stamp or one that predates its message — so a refused batch writes
 * nothing.
 */
export type MarkNotificationsRead = (
  userId: UserId,
  ids: readonly NotificationId[],
  readAtUtcMs: UtcEpochMs,
) => Promise<Result<void, RepositoryError>>;

/**
 * The waitlist matcher's cross-day cooldown probe (§4.1 `matchWaitlist`):
 * has this person already been told about this request since
 * `sinceUtcMs`? `notificationTopic ==`, `waitlistRequestId ==`,
 * `sentAtUtcMs >=`, `limit 1` (index #15, re-declared by flip (1);
 * `firestore-notification-writer.ts:105-122`). The request's `matched`
 * status is the primary guard; this survives a status write that failed
 * after the notification was written. A cooldown is elapsed real time (T2).
 */
export type HasRecentNotification = (
  userId: UserId,
  topic: NotificationTopic,
  waitlistRequestId: WaitlistRequestId,
  sinceUtcMs: UtcEpochMs,
) => Promise<Result<boolean, RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The signed-in account's inbox — the bundle the web's `INBOX_PORTS` token binds. */
export type InboxPorts = {
  readonly observeInbox: ObserveInbox;
  readonly markNotificationsRead: MarkNotificationsRead;
};

/** The notification cooldown check — the waitlist matcher (server). */
export type RecentNotificationPorts = {
  readonly hasRecentNotification: HasRecentNotification;
};

/** The notifications context's whole port suite — an intersection of its bundles. */
export type NotificationsPorts = InboxPorts & RecentNotificationPorts;
