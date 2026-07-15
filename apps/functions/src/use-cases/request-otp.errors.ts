import { IssueOtpError, RepositoryError } from '@creativo/domain/models';
import { DomainError, InvalidTimeZoneError } from '@creativo/domain/kernel';

export class InvalidInputError extends DomainError {
  readonly code = 'invalid_input' as const;
  constructor(public readonly reason: string) {
    super(`Invalid input: ${reason}`, { reason });
  }
}

export class RateLimitedError extends DomainError {
  readonly code = 'otp_rate_limited' as const;
  constructor() {
    super(
      'An OTP was already sent recently — please wait before requesting another.',
    );
  }
}

export class RepositoryFailure extends DomainError {
  readonly code = 'repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export class SendFailure extends DomainError {
  readonly code = 'otp_send_failure' as const;
  constructor(public override readonly cause: Error) {
    super('Failed to send OTP');
  }
}

export class ValidationFailure extends DomainError {
  readonly code = 'otp_validation_failed' as const;
  constructor(public readonly errors: IssueOtpError[]) {
    super('OTP validation failed');
  }
}

export type RequestOtpError =
  | InvalidInputError
  | RateLimitedError
  | RepositoryFailure
  | SendFailure
  | ValidationFailure
  // Only reachable if OTP_ZONE ('UTC', hardcoded) were ever invalid —
  // structurally impossible today, kept typed rather than cast away.
  | InvalidTimeZoneError;
