import { DomainError } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

export class ApplyDiscountsRepositoryFailure extends DomainError {
  readonly code = 'engagement.apply_discounts.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to load coupon grants');
  }
}

export type ApplyDiscountsError = ApplyDiscountsRepositoryFailure;
