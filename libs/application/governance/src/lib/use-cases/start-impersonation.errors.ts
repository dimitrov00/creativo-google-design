import { DomainError } from '@creativo/domain/kernel';
import { StartImpersonationSessionError } from '@creativo/domain/governance';
import { RepositoryError } from '@creativo/application/shared';

export class StartImpersonationValidationFailure extends DomainError {
  readonly code = 'governance.start_impersonation.validation_failed' as const;
  constructor(
    public readonly errors: readonly StartImpersonationSessionError[],
  ) {
    super('Impersonation session validation failed');
  }
}

export class StartImpersonationRepositoryFailure extends DomainError {
  readonly code = 'governance.start_impersonation.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new impersonation session');
  }
}

export type StartImpersonationError =
  StartImpersonationValidationFailure | StartImpersonationRepositoryFailure;
