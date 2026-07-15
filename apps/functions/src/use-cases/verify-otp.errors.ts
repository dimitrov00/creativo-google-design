import {
  AuthTokenError,
  RepositoryError,
  UserValidationError,
} from '@creativo/domain/models';
import { DomainError, InvalidTimeZoneError } from '@creativo/domain/kernel';

export class InvalidInputError extends DomainError {
  readonly code = 'invalid_input' as const;
  constructor(public readonly reason: string) {
    super(`Invalid input: ${reason}`, { reason });
  }
}

export class RepositoryFailure extends DomainError {
  readonly code = 'repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export class OtpNotFoundError extends DomainError {
  readonly code = 'otp_not_found' as const;
  constructor() {
    super('No such OTP request.');
  }
}

export class OtpAlreadyConsumedError extends DomainError {
  readonly code = 'otp_already_consumed' as const;
  constructor() {
    super('This OTP has already been used.');
  }
}

export class OtpExpiredError extends DomainError {
  readonly code = 'otp_expired' as const;
  constructor() {
    super('This OTP has expired.');
  }
}

export class OtpLockedOutError extends DomainError {
  readonly code = 'otp_locked_out' as const;
  constructor() {
    super('Too many incorrect attempts.');
  }
}

export class IncorrectCodeError extends DomainError {
  readonly code = 'otp_incorrect_code' as const;
  constructor() {
    super('Incorrect code.');
  }
}

export class UserValidationFailure extends DomainError {
  readonly code = 'user_validation_failed' as const;
  constructor(public readonly errors: UserValidationError[]) {
    super('New user validation failed');
  }
}

export class TokenMintingFailure extends DomainError {
  readonly code = 'token_minting_failure' as const;
  constructor(public override readonly cause: AuthTokenError) {
    super('Failed to mint session token');
  }
}

export type VerifyOtpError =
  | InvalidInputError
  | RepositoryFailure
  | OtpNotFoundError
  | OtpAlreadyConsumedError
  | OtpExpiredError
  | OtpLockedOutError
  | IncorrectCodeError
  | UserValidationFailure
  | TokenMintingFailure
  // Only reachable if OTP_ZONE ('UTC', hardcoded) were ever invalid —
  // structurally impossible today, kept typed rather than cast away.
  | InvalidTimeZoneError;
