import { DomainError } from '@creativo/domain/kernel';

export class AuthStrategyUnknownKindError extends DomainError {
  readonly code = 'identity.auth_strategy.unknown_kind' as const;
  constructor(public readonly received: string) {
    super(`unknown auth strategy kind: "${received}"`, { received });
  }
}

export class AuthStrategyUnknownFieldError extends DomainError {
  readonly code = 'identity.auth_strategy.unknown_field' as const;
  constructor(public readonly received: string) {
    super(`unknown registration field: "${received}"`, { received });
  }
}

export class AuthStrategyRequiredEmptyError extends DomainError {
  readonly code = 'identity.auth_strategy.required_empty' as const;
  constructor() {
    super('an auth strategy must require at least one registration field');
  }
}

export class AuthStrategyPhoneMissingError extends DomainError {
  readonly code = 'identity.auth_strategy.phone_missing' as const;
  constructor() {
    super(
      "every auth strategy's required fields must include 'phone' — the booking app always needs a contact channel",
    );
  }
}

export class AuthStrategyInvalidPolicyError extends DomainError {
  readonly code = 'identity.auth_strategy.invalid_policy' as const;
  constructor(public readonly reason: string) {
    super(`invalid auth strategy policy: ${reason}`, { reason });
  }
}

export type AuthStrategyError =
  | AuthStrategyUnknownKindError
  | AuthStrategyUnknownFieldError
  | AuthStrategyRequiredEmptyError
  | AuthStrategyPhoneMissingError
  | AuthStrategyInvalidPolicyError;
