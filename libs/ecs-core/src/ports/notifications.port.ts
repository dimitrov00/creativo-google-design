import type { Observable } from 'rxjs';
import type { NotificationKind } from '../components/notification-payload.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type {
  NotificationEntity,
  NotificationId,
} from '../entities/notification.entity';
import type { UserId } from '../entities/user.entity';
import type { WaitlistRequestId } from '../entities/waitlist-request.entity';

/**
 * A person's inbox — `users/{uid}/notifications`, the one owner-scoped
 * subcollection (blueprint §3.1, §4.2): payload facts, never formatted
 * words (§9 D20). The owner may update `readAtMs` only (rules
 * `hasOnly(['readAtMs'])`); a notification is CREATED only inside the
 * matcher's `CommitPlan`, never through a port.
 */

/** The newest 50 notifications, live — `orderBy sentAtMs desc limit 50`, single-field. */
export type ObserveInbox = (
  userId: UserId,
) => Observable<Result<readonly NotificationEntity[], RepositoryError>>;

/** Stamp one notification read at `readAtMs` (the caller's injected clock). */
export type MarkNotificationRead = (
  userId: UserId,
  id: NotificationId,
  readAtMs: number,
) => Promise<Result<void, RepositoryError>>;

/**
 * Stamp every unread notification read at `readAtMs` — `readAtMs == null
 * limit 400` per batch (`notification-reader.adapter.ts:121`).
 */
export type MarkAllNotificationsRead = (
  userId: UserId,
  readAtMs: number,
) => Promise<Result<void, RepositoryError>>;

/**
 * The waitlist matcher's cross-day cooldown probe (§4.1 `matchWaitlist`):
 * has this person already been told about this request since `sinceMs`?
 * `kind ==`, `requestId ==`, `sentAtMs >=`, `limit 1` (index #15,
 * `firestore-notification-writer.ts:105-122`). The request's `matched`
 * status is the primary guard; this survives a status write that failed
 * after the notification was written.
 */
export type HasRecentNotification = (
  userId: UserId,
  kind: NotificationKind,
  requestId: WaitlistRequestId,
  sinceMs: number,
) => Promise<Result<boolean, RepositoryError>>;

/** The notifications context's port catalogue; each root binds the `Pick` it implements. */
export type NotificationsPorts = {
  readonly observeInbox: ObserveInbox;
  readonly markNotificationRead: MarkNotificationRead;
  readonly markAllNotificationsRead: MarkAllNotificationsRead;
  readonly hasRecentNotification: HasRecentNotification;
};
