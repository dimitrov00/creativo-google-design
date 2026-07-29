import { Id, Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  EmptyNotificationIdError,
  EmptyNotificationTitleError,
  NotificationValidationError,
  ReadBeforeSentError,
} from './notification.errors';

export class NotificationId extends Id<'Notification'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<NotificationId, EmptyNotificationIdError> {
    return raw.trim().length === 0
      ? fail(new EmptyNotificationIdError())
      : ok(new NotificationId(raw));
  }
}

/**
 * What the notification is ABOUT — drives its glyph and, later, whether a
 * channel may suppress it. A closed union rather than a free string: the
 * UI has to render every case, so a new kind should break the build until
 * someone gives it an icon and copy.
 */
export type NotificationKind =
  | 'appointment_reminder'
  | 'appointment_changed'
  | 'reward_granted'
  | 'announcement';

export interface NotificationProps {
  readonly id: string;
  readonly kind: NotificationKind;
  /** Already localized by whoever wrote it — notifications are authored per recipient, not translated at render. */
  readonly title: string;
  readonly body?: string;
  readonly sentAt: ZonedDateTime;
  readonly readAt?: ZonedDateTime | null;
  /** In-app destination this notification points at, if any (`/account/appointments`). */
  readonly deepLink?: string | null;
}

/**
 * **Aggregate root** for one delivered message.
 *
 * Read state lives HERE rather than in a separate join: "unread" is a
 * property of the notification for this recipient, and every surface that
 * shows a badge is asking the same question. `markRead` returns a NEW
 * instance — the aggregate is immutable like the rest of the domain, so a
 * signal holding one can't be mutated out from under a template.
 *
 * Deliberately NOT modelled yet (no use-case needs them): delivery
 * channels (push/email/SMS), per-channel receipts, and grouping/threading.
 * The port returns whole notifications, so adding them later is additive.
 */
export class Notification {
  private constructor(
    readonly id: NotificationId,
    readonly kind: NotificationKind,
    readonly title: string,
    readonly body: string | null,
    readonly sentAt: ZonedDateTime,
    readonly readAt: ZonedDateTime | null,
    readonly deepLink: string | null,
  ) {}

  static create(
    props: NotificationProps,
  ): Result<Notification, NotificationValidationError[]> {
    return Notification.build(props);
  }

  static reconstitute(
    props: NotificationProps,
  ): Result<Notification, NotificationValidationError[]> {
    return Notification.build(props);
  }

  private static build(
    props: NotificationProps,
  ): Result<Notification, NotificationValidationError[]> {
    const errors: NotificationValidationError[] = [];

    const idResult = NotificationId.create(props.id);
    if (idResult.isFailure()) errors.push(idResult.error);

    const title = props.title.trim();
    if (title.length === 0) errors.push(new EmptyNotificationTitleError());

    const readAt = props.readAt ?? null;
    if (readAt && readAt.isBefore(props.sentAt)) {
      // Clock skew between writer and reader is real; a receipt that
      // predates its own message is a bug worth surfacing, not rounding.
      errors.push(
        new ReadBeforeSentError(props.sentAt.toISO(), readAt.toISO()),
      );
    }

    if (errors.length > 0 || idResult.isFailure()) {
      return fail(errors);
    }

    return ok(
      new Notification(
        idResult.value,
        props.kind,
        title,
        props.body?.trim() || null,
        props.sentAt,
        readAt,
        props.deepLink ?? null,
      ),
    );
  }

  isUnread(): boolean {
    return this.readAt === null;
  }

  /** Already-read notifications return THIS — marking twice must not move the receipt. */
  markRead(at: ZonedDateTime): Notification {
    if (this.readAt !== null) return this;
    return new Notification(
      this.id,
      this.kind,
      this.title,
      this.body,
      this.sentAt,
      at,
      this.deepLink,
    );
  }
}

/** How many of these are unread — the number every badge renders. */
export function unreadCount(notifications: readonly Notification[]): number {
  return notifications.reduce(
    (count, notification) => count + (notification.isUnread() ? 1 : 0),
    0,
  );
}
