import { DomainError } from '@creativo/domain/kernel';

export class EmailInvalidError extends DomainError {
  override readonly code = 'accounts.email.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a valid email address`, { attempted });
  }
}
