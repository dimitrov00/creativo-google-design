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
 * (D29). The owner may update the read stamp only; a notification is
 * CREATED only inside the matcher's `CommitPlan`, never through a port.
 */

/** The newest 50 notifications, live — `orderBy sentAtUtcMs desc limit 50`, single-field. */
export type ObserveInbox = (
  userId: UserId,
) => Observable<Result<readonly InboxNotification[], RepositoryError>>;

/** Stamp one notification read at `readAtUtcMs` (the caller's injected clock). */
export type MarkNotificationRead = (
  userId: UserId,
  id: NotificationId,
  readAtUtcMs: UtcEpochMs,
) => Promise<Result<void, RepositoryError>>;

/**
 * Stamp every unread notification read at `readAtUtcMs` — the unread ones
 * (`readAtUtcMs == null`), `limit 400` per batch
 * (`notification-reader.adapter.ts:121`).
 */
export type MarkAllNotificationsRead = (
  userId: UserId,
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
  readonly markNotificationRead: MarkNotificationRead;
  readonly markAllNotificationsRead: MarkAllNotificationsRead;
};

/** The notification cooldown check — the waitlist matcher (server). */
export type RecentNotificationPorts = {
  readonly hasRecentNotification: HasRecentNotification;
};

/** The notifications context's whole port suite — an intersection of its bundles. */
export type NotificationsPorts = InboxPorts & RecentNotificationPorts;
