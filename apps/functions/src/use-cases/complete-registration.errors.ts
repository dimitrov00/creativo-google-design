import { UserValidationError } from '@creativo/domain/accounts';
import { DomainError } from '@creativo/domain/kernel';
import { AuthTokenError } from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { BirthDateError, RegistrationField } from '@creativo/domain/identity';

export class InvalidInputError extends DomainError {
  readonly code = 'invalid_input' as const;
  constructor(public readonly reason: string) {
    super(`Invalid input: ${reason}`, { reason });
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'registration_unauthenticated' as const;
  constructor() {
    super('Registration requires a signed-in (OTP-verified) session.');
  }
}

export class RegistrationForbiddenError extends DomainError {
  readonly code = 'registration_forbidden' as const;
  constructor() {
    super('This registration does not belong to the signed-in session.');
  }
}

export class MissingRegistrationFieldError extends DomainError {
  readonly code = 'registration_field_missing' as const;
  constructor(public readonly field: RegistrationField) {
    super(`Missing required registration field: ${field}`, { field });
  }
}

/**
 * The OPTIONAL `birthDate` field was submitted but failed the `BirthDate`
 * VO's invariants (not a real ISO calendar date / in the future / age
 * outside 16–120). Wraps the domain error so the callable can forward its
 * reason-specific stable code (`identity.birth_date.*`) for localization,
 * mirroring `UserValidationFailure`'s `errors` forwarding.
 */
export class InvalidBirthDateError extends DomainError {
  readonly code = 'registration_birth_date_invalid' as const;
  constructor(public override readonly cause: BirthDateError) {
    super('Submitted birth date failed validation', { reason: cause.code });
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = 'registration_user_not_found' as const;
  constructor() {
    super(
      'No provisioned user for this identifier — verify the OTP challenge first.',
    );
  }
}

export class RepositoryFailure extends DomainError {
  readonly code = 'repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export class UserValidationFailure extends DomainError {
  readonly code = 'user_validation_failed' as const;
  constructor(public readonly errors: UserValidationError[]) {
    super('Updated user validation failed');
  }
}

export class ClaimsPromotionFailure extends DomainError {
  readonly code = 'claims_promotion_failure' as const;
  constructor(public override readonly cause: AuthTokenError) {
    super('Failed to promote onboarding claims to active');
  }
}

export type CompleteRegistrationError =
  | InvalidInputError
  | UnauthenticatedError
  | RegistrationForbiddenError
  | MissingRegistrationFieldError
  | InvalidBirthDateError
  | UserNotFoundError
  | RepositoryFailure
  | UserValidationFailure
  | ClaimsPromotionFailure;
