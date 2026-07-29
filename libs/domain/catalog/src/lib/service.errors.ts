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

export class UnknownVariantTermsError extends DomainError {
  readonly code = 'catalog.service.unknown_variant_terms' as const;
  constructor(
    public readonly barberId: string,
    public readonly variantId: string,
  ) {
    super(
      `Barber ${barberId} prices variant "${variantId}", which this service does not offer`,
      { barberId, variantId },
    );
  }
}

export class DuplicateVariantTermsError extends DomainError {
  readonly code = 'catalog.service.duplicate_variant_terms' as const;
  constructor(
    public readonly barberId: string,
    public readonly variantId: string,
  ) {
    super(`Barber ${barberId} prices variant "${variantId}" more than once`, {
      barberId,
      variantId,
    });
  }
}

export class DuplicateServiceVariantError extends DomainError {
  readonly code = 'catalog.service.duplicate_variant' as const;
  constructor(public readonly variantId: string) {
    super(`Service declares variant "${variantId}" more than once`, {
      variantId,
    });
  }
}

export class DuplicateBarberOfferingError extends DomainError {
  readonly code = 'catalog.service.duplicate_offering' as const;
  constructor(public readonly barberId: string) {
    super(`Service lists barber ${barberId} more than once`, { barberId });
  }
}

export class MixedCurrencyTermsError extends DomainError {
  readonly code = 'catalog.service.mixed_currency_terms' as const;
  constructor(
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(
      `Every price on a service must share one currency: expected ${expected}, found ${found}`,
      { expected, found },
    );
  }
}

/** Errors reachable while building the terms matrix (`ServiceTerms`, `ServiceVariant`, `BarberOffering`). */
export type ServiceTermsValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidMoneyAmountError
  | UnknownCurrencyCodeError
  | InvalidServiceDurationError
  | UnknownVariantTermsError
  | DuplicateVariantTermsError;

export type ServiceValidationError =
  | ServiceTermsValidationError
  | InvalidServiceSortOrderError
  | EmptyBundleIncludesError
  | DuplicateServiceVariantError
  | DuplicateBarberOfferingError
  | MixedCurrencyTermsError;
