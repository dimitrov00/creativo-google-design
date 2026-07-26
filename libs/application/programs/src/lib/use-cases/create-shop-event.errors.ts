import { DomainError } from '@creativo/domain/kernel';
import { ShopEventValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class CreateShopEventValidationFailure extends DomainError {
  readonly code = 'programs.create_shop_event.validation_failed' as const;
  constructor(public readonly errors: readonly ShopEventValidationError[]) {
    super('Event validation failed');
  }
}

export class CreateShopEventRepositoryFailure extends DomainError {
  readonly code = 'programs.create_shop_event.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new event');
  }
}

export type CreateShopEventError =
  CreateShopEventValidationFailure | CreateShopEventRepositoryFailure;
