import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { IdentifierInvalidError } from './identifier.errors';

export class EmptyCodeHashError extends DomainError {
  readonly code = 'identity.otp.empty_code_hash' as const;
  constructor() {
    super('OTP codeHash cannot be empty');
  }
}

export class EmptySaltError extends DomainError {
  readonly code = 'identity.otp.empty_salt' as const;
  constructor() {
    super('OTP salt cannot be empty');
  }
}

export class InvalidMaxAttemptsError extends DomainError {
  readonly code = 'identity.otp.invalid_max_attempts' as const;
  constructor(public readonly rawValue: number) {
    super(`maxAttempts must be a positive integer: ${rawValue}`, { rawValue });
  }
}

export type IssueOtpError =
  | EmptyIdError
  | IdentifierInvalidError
  | EmptyCodeHashError
  | EmptySaltError
  | InvalidMaxAttemptsError
  | InvalidDateTimeError;

/**
 * Kept as a `{kind}` union rather than a class hierarchy — the caller
 * branches on it immediately (which UI copy to show / whether to allow a
 * retry), it never propagates further as a typed exception. Mirrors this
 * repo's existing `libs/domain/models`'s `OtpVerificationError` exactly.
 */
export type OtpVerificationError =
  | { readonly kind: 'already_consumed' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'locked_out' }
  | { readonly kind: 'wrong_code' };
