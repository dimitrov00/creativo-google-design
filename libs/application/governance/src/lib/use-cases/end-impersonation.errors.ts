import { DomainError } from '@creativo/domain/kernel';
import { ImpersonationSessionAlreadyEndedError } from '@creativo/domain/governance';
import { RepositoryError } from '@creativo/application/shared';

export class ImpersonationSessionNotFoundError extends DomainError {
  readonly code = 'governance.end_impersonation.not_found' as const;
  constructor() {
    super('No such impersonation session.');
  }
}

export class EndImpersonationRepositoryFailure extends DomainError {
  readonly code = 'governance.end_impersonation.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export type EndImpersonationError =
  | ImpersonationSessionNotFoundError
  | ImpersonationSessionAlreadyEndedError
  | EndImpersonationRepositoryFailure;
