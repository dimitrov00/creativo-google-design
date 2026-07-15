import {
  DomainError,
  InvalidMoneyAmountError,
  UnknownCurrencyCodeError,
} from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

export class EmptyServiceNameError extends DomainError {
  readonly code = 'service_name_empty' as const;
  constructor() {
    super('Service name cannot be empty');
  }
}

export class InvalidServiceDurationError extends DomainError {
  readonly code = 'invalid_service_duration' as const;
  constructor(public readonly rawValue: number) {
    super(
      `Service duration must be a positive integer number of minutes: ${rawValue}`,
      {
        rawValue,
      },
    );
  }
}

export type ServiceValidationError =
  | EmptyIdError
  | EmptyServiceNameError
  | InvalidServiceDurationError
  | InvalidMoneyAmountError
  | UnknownCurrencyCodeError;
