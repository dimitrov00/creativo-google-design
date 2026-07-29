import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { Notification, NotificationId } from '@creativo/domain/notifications';
import { UserId } from '@creativo/domain/accounts';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { NotificationReader } from '../ports/notification-reader.port';

/**
 * PLACEHOLDER adapter — swap for the Firestore one when the feature lands.
 *
 * Deliberately a real adapter behind the real port, not a mock in a spec:
 * the menu row, its badge and the read receipt all exercise the actual
 * seam, so replacing this is one line in `app.config.ts` and nothing above
 * it changes. It seeds a couple of plausible messages so the badge has
 * something to render in dev.
 *
 * Lives in the application lib rather than `infrastructure/` on purpose —
 * it has no IO to speak of, and putting a fake in the infrastructure
 * folder would make it look like a shipping integration. The loud name is
 * the point.
 *
 * State is per-session and per-instance: a reload starts over, and the
 * `userId` argument is accepted (so callers are written correctly) but not
 * partitioned on — a stub with one inbox is honest about being a stub.
 */
@Injectable()
export class InMemoryNotificationReader implements NotificationReader {
  private readonly clock = inject(CLOCK);
  private readonly inbox = new BehaviorSubject<readonly Notification[]>(
    this.seed(),
  );

  list(
    _userId: UserId,
  ): Observable<Result<readonly Notification[], RepositoryError>> {
    return this.inbox.pipe(map((notifications) => ok(notifications)));
  }

  async markRead(
    _userId: UserId,
    id: NotificationId,
  ): Promise<Result<void, RepositoryError>> {
    const now = this.now();
    if (now) {
      this.inbox.next(
        this.inbox.value.map((notification) =>
          notification.id.equals(id)
            ? notification.markRead(now)
            : notification,
        ),
      );
    }
    return ok(undefined);
  }

  async markAllRead(_userId: UserId): Promise<Result<void, RepositoryError>> {
    const now = this.now();
    if (now) {
      this.inbox.next(
        this.inbox.value.map((notification) => notification.markRead(now)),
      );
    }
    return ok(undefined);
  }

  private now(): ZonedDateTime | null {
    const result = this.clock.now('UTC');
    return result.isSuccess() ? result.value : null;
  }

  /** Two unread, one already read — enough to prove the badge counts and the row renders. */
  private seed(): readonly Notification[] {
    const now = this.now();
    if (!now) return [];
    const drafts = [
      {
        id: 'ntf-reminder',
        kind: 'appointment_reminder' as const,
        title: 'Часът ви е утре в 14:30',
        body: 'Класическа подстрижка при Иван Колев.',
        deepLink: '/account/appointments',
      },
      {
        id: 'ntf-reward',
        kind: 'reward_granted' as const,
        title: 'Спечелихте награда',
        body: 'Безплатно оформяне на брада при следващото посещение.',
        deepLink: '/account',
      },
      {
        id: 'ntf-announcement',
        kind: 'announcement' as const,
        title: 'Нови часове в събота',
        body: 'Отваряме и в събота от 10:00.',
        readAt: now,
      },
    ];
    return drafts.flatMap((draft) => {
      const result = Notification.create({ ...draft, sentAt: now });
      return result.isSuccess() ? [result.value] : [];
    });
  }
}
