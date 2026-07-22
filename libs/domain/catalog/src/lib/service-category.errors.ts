import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class InvalidServiceCategorySortOrderError extends DomainError {
  readonly code = 'catalog.service_category.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(
      `Service category sort order must be a non-negative integer: ${rawValue}`,
      { rawValue },
    );
  }
}

export type ServiceCategoryValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidServiceCategorySortOrderError;
