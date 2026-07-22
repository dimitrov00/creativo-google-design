import { DomainError } from '@creativo/domain/kernel';

export class EmptyRolesError extends DomainError {
  readonly code = 'identity.auth_claims.empty_roles' as const;
  constructor() {
    super('an active principal must carry at least one role');
  }
}
