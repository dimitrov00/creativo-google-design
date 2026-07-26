import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError as CatalogEmptyIdError } from '@creativo/domain/catalog';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class InvalidShopEventSortOrderError extends DomainError {
  readonly code = 'programs.shop_event.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Event sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export class InvalidShopEventApplyUrlError extends DomainError {
  readonly code = 'programs.shop_event.invalid_apply_url' as const;
  constructor(public readonly rawValue: string) {
    super(`Event RSVP URL is not a valid URL: ${rawValue}`, { rawValue });
  }
}

export type ShopEventValidationError =
  | EmptyIdError
  | CatalogEmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidDateTimeError
  | InvalidShopEventSortOrderError
  | InvalidShopEventApplyUrlError;
