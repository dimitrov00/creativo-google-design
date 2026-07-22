import { DomainError } from '@creativo/domain/kernel';
import { InvalidLocaleError } from './locale.errors';
import { UnknownCurrencyCodeError } from './currency-code.errors';

export class EmptyTenantConfigNameError extends DomainError {
  override readonly code = 'governance.tenant_config.empty_name' as const;
  constructor() {
    super('TenantConfig name cannot be empty');
  }
}

/**
 * Own error class rather than reusing kernel's `InvalidTimeZoneError`
 * (that one is `ZonedDateTime.now()`'s own failure mode) — mirrors this
 * repo's `models/tenant.ts`, which likewise defines its own
 * `InvalidTenantTimezoneError` instead of reusing kernel's.
 */
export class InvalidTenantConfigTimezoneError extends DomainError {
  override readonly code = 'governance.tenant_config.invalid_timezone' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a valid IANA time zone`, { attempted });
  }
}

export type TenantConfigValidationError =
  | EmptyTenantConfigNameError
  | InvalidTenantConfigTimezoneError
  | InvalidLocaleError
  | UnknownCurrencyCodeError;
