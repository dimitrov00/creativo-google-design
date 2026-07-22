import { DomainError } from '@creativo/domain/kernel';
import { UserValidationError } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { ContactChangeError } from '../ports/contact-change.errors';

export class ConfirmContactChangeProfileNotFoundError extends DomainError {
  readonly code = 'accounts.confirm_contact_change.profile_not_found' as const;
  constructor() {
    super('No such user profile.');
  }
}

export class ConfirmContactChangeFailure extends DomainError {
  readonly code =
    'accounts.confirm_contact_change.confirmation_failed' as const;
  constructor(public override readonly cause: ContactChangeError) {
    super('Failed to confirm the contact change');
  }
}

export class ConfirmContactChangeValidationFailure extends DomainError {
  readonly code = 'accounts.confirm_contact_change.validation_failed' as const;
  constructor(public readonly errors: readonly UserValidationError[]) {
    super('Updated profile failed validation');
  }
}

export class ConfirmContactChangeRepositoryFailure extends DomainError {
  readonly code = 'accounts.confirm_contact_change.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export type ConfirmContactChangeError =
  | ConfirmContactChangeProfileNotFoundError
  | ConfirmContactChangeFailure
  | ConfirmContactChangeValidationFailure
  | ConfirmContactChangeRepositoryFailure;
