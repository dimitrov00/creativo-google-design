import { DomainError } from '@creativo/domain/kernel';

/**
 * As many days as the tenant allows are already selected.
 *
 * A real rejection rather than a UI-only guard, for the same reason
 * `PartyFullError` is one: a cap enforced only by an untappable cell is a cap
 * that a restored draft or a replayed tap walks straight through.
 */
export class FlexibleWhenFullError extends DomainError {
  override readonly code = 'scheduling.flexible_when.full' as const;
  constructor(public readonly max: number) {
    super(`A flexible request covers at most ${max} days`, { max });
  }
}

export type FlexibleWhenError = FlexibleWhenFullError;
