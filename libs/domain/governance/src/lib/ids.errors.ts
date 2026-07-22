import { DomainError } from '@creativo/domain/kernel';

/**
 * Same shape as `libs/domain/models/src/lib/ids.errors.ts` /
 * `libs/domain/accounts/src/lib/ids.errors.ts` — this context's own copy
 * because each bounded context mints its own id-brand family and doesn't
 * share error classes across `type:domain` libs.
 */
export class EmptyIdError extends DomainError {
  override readonly code = 'governance.id.empty' as const;
  constructor(public readonly idType: string) {
    super(`${idType} cannot be empty`, { idType });
  }
}
