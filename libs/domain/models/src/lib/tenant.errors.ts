import { DomainError } from '@creativo/domain/kernel';
import { InvalidEmailError } from './email.errors';
import { EmptyIdError } from './ids.errors';

export class EmptyTenantNameError extends DomainError {
  readonly code = 'tenant_name_empty' as const;
  constructor() {
    super('Tenant name cannot be empty');
  }
}

export class InvalidTenantSlugError extends DomainError {
  readonly code = 'invalid_tenant_slug' as const;
  constructor(public readonly rawValue: string) {
    super(
      `Invalid tenant slug "${rawValue}" — must be lowercase letters, digits, and hyphens only`,
      { rawValue },
    );
  }
}

export class InvalidTenantTimezoneError extends DomainError {
  readonly code = 'invalid_tenant_timezone' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid tenant time zone: "${rawValue}"`, { rawValue });
  }
}

export type TenantValidationError =
  | EmptyIdError
  | EmptyTenantNameError
  | InvalidTenantSlugError
  | InvalidTenantTimezoneError
  | InvalidEmailError;
