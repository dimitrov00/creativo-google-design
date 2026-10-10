import { Id, Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { NotificationSystem } from '@creativo/ecs-core';
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
  /**
   * A standing waitlist request found something. The one kind that is
   * time-critical: the slot it names is not held, so the notification is an
   * invitation to race for it and its copy has to say so.
   */
  | 'waitlist_match'
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
 *
 * A thin shim since the ECS migration's Phase 2: the read state and the
 * receipt rule are `NotificationSystem` (`@creativo/ecs-core`); the bridge
 * is `receiptOf` at the end.
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
    if (
      readAt !== null &&
      NotificationSystem.readBeforeSent({
        sentAtMs: props.sentAt.toMillis(),
        readAtMs: readAt.toMillis(),
      }) !== null
    ) {
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
    return NotificationSystem.isUnread(receiptOf(this));
  }

  /** Already-read notifications return THIS — marking twice must not move the receipt. */
  markRead(at: ZonedDateTime): Notification {
    const receipt = receiptOf(this);
    if (NotificationSystem.markRead(receipt, at.toMillis()) === receipt) {
      return this;
    }
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
  return NotificationSystem.unreadCount(notifications.map(badgeReceiptOf));
}

// ── The bridge: legacy class → ecs-core struct (Phase 4 deletes it) ──────

/** The receipt as the system reads it: the instant in ms, `null` = unread. */
function receiptOf(notification: Notification): {
  readonly readAtMs: number | null;
} {
  return {
    readAtMs:
      notification.readAt === null ? null : notification.readAt.toMillis(),
  };
}

/**
 * The receipt as the badge reads it: `isUnread()` is the one thing the
 * legacy count ever asked of a notification, so the bridge asks nothing
 * more of an unread one (a reader double may answer only that).
 */
function badgeReceiptOf(notification: Notification): {
  readonly readAtMs: number | null;
} {
  return notification.isUnread() ? { readAtMs: null } : receiptOf(notification);
}
