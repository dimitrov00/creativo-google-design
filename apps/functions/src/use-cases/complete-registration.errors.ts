import { UserValidationError } from '@creativo/domain/models';
import { DomainError } from '@creativo/domain/kernel';
import { AuthTokenError } from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { RegistrationField } from '@creativo/domain/identity';

export class InvalidInputError extends DomainError {
  readonly code = 'invalid_input' as const;
  constructor(public readonly reason: string) {
    super(`Invalid input: ${reason}`, { reason });
  }
}

export class MissingRegistrationFieldError extends DomainError {
  readonly code = 'registration_field_missing' as const;
  constructor(public readonly field: RegistrationField) {
    super(`Missing required registration field: ${field}`, { field });
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
  | MissingRegistrationFieldError
  | UserNotFoundError
  | RepositoryFailure
  | UserValidationFailure
  | ClaimsPromotionFailure;
