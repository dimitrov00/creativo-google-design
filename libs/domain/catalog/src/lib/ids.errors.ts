import { DomainError } from '@creativo/domain/kernel';

/** Same shape as `libs/domain/models/src/lib/ids.errors.ts`'s `EmptyIdError` — this context keeps its own copy rather than importing across the `catalog`/`models` boundary for a single tiny error class. */
export class EmptyIdError extends DomainError {
  readonly code = 'catalog.id.empty' as const;
  constructor(public readonly idType: string) {
    super(`${idType} cannot be empty`, { idType });
  }
}
