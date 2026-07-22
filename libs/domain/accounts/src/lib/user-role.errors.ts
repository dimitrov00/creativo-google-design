import { DomainError } from '@creativo/domain/kernel';

export class InvalidUserRoleError extends DomainError {
  override readonly code = 'accounts.user_role.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a known user role`, { attempted });
  }
}
