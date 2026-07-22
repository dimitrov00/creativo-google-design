import { DomainError } from '@creativo/domain/kernel';
import { UserValidationError } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export class ProfileNotFoundError extends DomainError {
  readonly code = 'accounts.update_profile.not_found' as const;
  constructor() {
    super('No such user profile.');
  }
}

export class UpdateProfileValidationFailure extends DomainError {
  readonly code = 'accounts.update_profile.validation_failed' as const;
  constructor(public readonly errors: readonly UserValidationError[]) {
    super('Profile update validation failed');
  }
}

export class UpdateProfileRepositoryFailure extends DomainError {
  readonly code = 'accounts.update_profile.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export type UpdateProfileError =
  | ProfileNotFoundError
  | UpdateProfileValidationFailure
  | UpdateProfileRepositoryFailure;
