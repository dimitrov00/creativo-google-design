import { DomainError } from '@creativo/domain/kernel';

export class EmptyNotificationIdError extends DomainError {
  readonly code = 'notifications.notification.empty_id' as const;
  constructor() {
    super('A notification id cannot be empty');
  }
}

export class EmptyNotificationTitleError extends DomainError {
  readonly code = 'notifications.notification.empty_title' as const;
  constructor() {
    super('A notification must carry a non-empty title');
  }
}

export class ReadBeforeSentError extends DomainError {
  readonly code = 'notifications.notification.read_before_sent' as const;
  constructor(
    public readonly sentAt: string,
    public readonly readAt: string,
  ) {
    super(
      `A notification cannot be read (${readAt}) before it was sent (${sentAt})`,
      {
        sentAt,
        readAt,
      },
    );
  }
}

export type NotificationValidationError =
  EmptyNotificationIdError | EmptyNotificationTitleError | ReadBeforeSentError;
