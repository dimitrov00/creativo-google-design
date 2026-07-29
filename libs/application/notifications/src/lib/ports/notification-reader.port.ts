import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Notification, NotificationId } from '@creativo/domain/notifications';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The recipient's own notification inbox.
 *
 * `list` is an `Observable` (blueprint §5.2) because a badge that only
 * updates on navigation is a badge people stop trusting — the count has to
 * move when something arrives. Unread is derived from the SAME stream via
 * the domain's `unreadCount`, not a second counter query: two sources for
 * one number is how a badge ends up disagreeing with the list behind it.
 *
 * `markRead` is here rather than on a write port because there is exactly
 * one mutation and it is a read-side receipt; a separate repository would
 * be ceremony around a single call.
 */
export interface NotificationReader {
  list(
    userId: UserId,
  ): Observable<Result<readonly Notification[], RepositoryError>>;

  markRead(
    userId: UserId,
    id: NotificationId,
  ): Promise<Result<void, RepositoryError>>;

  /** Receipt for everything currently delivered — what "clear the badge" calls. */
  markAllRead(userId: UserId): Promise<Result<void, RepositoryError>>;
}

export const NOTIFICATION_READER = new InjectionToken<NotificationReader>(
  'NotificationReader',
);
