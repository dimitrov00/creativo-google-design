import { DomainError } from '@creativo/domain/kernel';

export class InvalidBlockReasonError extends DomainError {
  override readonly code = 'accounts.block_reason.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a known block reason`, { attempted });
  }
}
