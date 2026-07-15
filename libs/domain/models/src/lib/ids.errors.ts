import { DomainError } from '@creativo/domain/kernel';

export class EmptyIdError extends DomainError {
  readonly code = 'empty_id' as const;
  constructor(public readonly idType: string) {
    super(`${idType} cannot be empty`, { idType });
  }
}
