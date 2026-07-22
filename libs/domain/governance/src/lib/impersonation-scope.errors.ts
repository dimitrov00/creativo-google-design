import { DomainError } from '@creativo/domain/kernel';

export class InvalidImpersonationScopeError extends DomainError {
  override readonly code = 'governance.impersonation_scope.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a valid impersonation scope`, { attempted });
  }
}
