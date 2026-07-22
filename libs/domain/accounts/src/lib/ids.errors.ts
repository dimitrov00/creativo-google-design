import { DomainError } from '@creativo/domain/kernel';

export class EmptyIdError extends DomainError {
  override readonly code = 'accounts.id.empty' as const;
  constructor(public readonly idType: string) {
    super(`${idType} cannot be empty`, { idType });
  }
}
