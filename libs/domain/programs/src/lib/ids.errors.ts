import { DomainError } from '@creativo/domain/kernel';

/** Same shape as `catalog`'s `EmptyIdError` — this context keeps its own copy rather than importing across the `programs`/`catalog` boundary for a single tiny error class. */
export class EmptyIdError extends DomainError {
  readonly code = 'programs.id.empty' as const;
  constructor(public readonly idType: string) {
    super(`${idType} cannot be empty`, { idType });
  }
}
