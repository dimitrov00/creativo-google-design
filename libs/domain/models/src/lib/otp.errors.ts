import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

export class EmptyDestinationError extends DomainError {
  readonly code = 'otp_destination_empty' as const;
  constructor() {
    super('OTP destination cannot be empty');
  }
}

export class InvalidMaxAttemptsError extends DomainError {
  readonly code = 'invalid_otp_max_attempts' as const;
  constructor(public readonly rawValue: number) {
    super(`maxAttempts must be a positive integer: ${rawValue}`, { rawValue });
  }
}

export type IssueOtpError =
  | EmptyIdError
  | EmptyDestinationError
  | InvalidMaxAttemptsError
  | InvalidDateTimeError;

export type OtpVerificationError =
  | { readonly kind: 'already_consumed' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'locked_out' }
  | { readonly kind: 'wrong_code' };
