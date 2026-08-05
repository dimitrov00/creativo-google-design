import { DomainError } from '@creativo/domain/kernel';

/**
 * Nobody to notify.
 *
 * The one refusal here that is not really a failure: `/book` is browsable
 * anonymously by design, so a visitor reaching the waitlist without an account
 * is the NORMAL path, and the client turns this into a sign-in prompt rather
 * than an error banner.
 */
export class RequestWaitlistUnauthenticatedError extends DomainError {
  override readonly code = 'booking.waitlist.unauthenticated' as const;
  constructor() {
    super('Sign in to be told when something opens up');
  }
}

export class RequestWaitlistInvalidError extends DomainError {
  override readonly code = 'booking.waitlist.invalid_request' as const;
  constructor(public readonly field: string) {
    super(`Waitlist request is invalid: ${field}`, { field });
  }
}

export class RequestWaitlistTooManyDaysError extends DomainError {
  override readonly code = 'booking.waitlist.too_many_days' as const;
  constructor(public readonly max: number) {
    super(`A waitlist request covers at most ${max} days`, {
      max: String(max),
    });
  }
}

/**
 * The same days are already being watched for the same bag.
 *
 * Refused rather than deduplicated silently, because the honest answer to
 * "watch these days for me" when they are already being watched is "we are" —
 * and a second identical request would double every notification.
 */
export class RequestWaitlistDuplicateError extends DomainError {
  override readonly code = 'booking.waitlist.already_watching' as const;
  constructor() {
    super('These days are already being watched for you');
  }
}

export type RequestWaitlistError =
  | RequestWaitlistUnauthenticatedError
  | RequestWaitlistInvalidError
  | RequestWaitlistTooManyDaysError
  | RequestWaitlistDuplicateError;
