import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class EmptyBarberHandleError extends DomainError {
  readonly code = 'catalog.barber.empty_handle' as const;
  constructor() {
    super('Barber handle cannot be empty');
  }
}

export class InvalidBarberYearsExperienceError extends DomainError {
  readonly code = 'catalog.barber.invalid_years_experience' as const;
  constructor(public readonly rawValue: number) {
    super(
      `Barber years of experience must be a non-negative integer: ${rawValue}`,
      { rawValue },
    );
  }
}

export class InvalidBarberSortOrderError extends DomainError {
  readonly code = 'catalog.barber.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Barber sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export type BarberValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | EmptyBarberHandleError
  | InvalidBarberYearsExperienceError
  | InvalidBarberSortOrderError;
