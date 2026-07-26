import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError as CatalogEmptyIdError } from '@creativo/domain/catalog';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class InvalidPositionSortOrderError extends DomainError {
  readonly code = 'programs.position.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Position sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export class InvalidPositionApplyUrlError extends DomainError {
  readonly code = 'programs.position.invalid_apply_url' as const;
  constructor(public readonly rawValue: string) {
    super(`Position apply URL is not a valid URL: ${rawValue}`, { rawValue });
  }
}

export type PositionValidationError =
  | EmptyIdError
  | CatalogEmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidPositionSortOrderError
  | InvalidPositionApplyUrlError;
