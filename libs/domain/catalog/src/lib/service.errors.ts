import {
  DomainError,
  InvalidMoneyAmountError,
  UnknownCurrencyCodeError,
} from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class InvalidServiceDurationError extends DomainError {
  readonly code = 'catalog.service.invalid_duration' as const;
  constructor(public readonly rawValue: number) {
    super(
      `Service duration must be a positive integer number of minutes: ${rawValue}`,
      { rawValue },
    );
  }
}

export class InvalidServiceSortOrderError extends DomainError {
  readonly code = 'catalog.service.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Service sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export class EmptyBundleIncludesError extends DomainError {
  readonly code = 'catalog.service.empty_bundle_includes' as const;
  constructor() {
    super('A bundle service must include at least one component service');
  }
}

export type ServiceValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidMoneyAmountError
  | UnknownCurrencyCodeError
  | InvalidServiceDurationError
  | InvalidServiceSortOrderError
  | EmptyBundleIncludesError;
