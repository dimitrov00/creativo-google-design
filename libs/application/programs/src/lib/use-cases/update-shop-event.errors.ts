import { DomainError } from '@creativo/domain/kernel';
import { ShopEventValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class ShopEventNotFoundError extends DomainError {
  readonly code = 'programs.update_shop_event.not_found' as const;
  constructor() {
    super('No event exists with the given id');
  }
}

export class UpdateShopEventValidationFailure extends DomainError {
  readonly code = 'programs.update_shop_event.validation_failed' as const;
  constructor(public readonly errors: readonly ShopEventValidationError[]) {
    super('Event validation failed');
  }
}

export class UpdateShopEventRepositoryFailure extends DomainError {
  readonly code = 'programs.update_shop_event.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the updated event');
  }
}

export type UpdateShopEventError =
  | ShopEventNotFoundError
  | UpdateShopEventValidationFailure
  | UpdateShopEventRepositoryFailure;
