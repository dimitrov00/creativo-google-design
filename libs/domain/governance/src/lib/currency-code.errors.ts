import { DomainError } from '@creativo/domain/kernel';

/**
 * Distinct from kernel's own `UnknownCurrencyCodeError` (`money.errors.ts`)
 * — that one is `Money`'s own failure mode; this is `TenantConfig`'s,
 * co-located per this repo's "one error class per failure mode" rule
 * rather than reused across contexts.
 */
export class UnknownCurrencyCodeError extends DomainError {
  override readonly code = 'governance.currency_code.unknown' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a known currency code`, { attempted });
  }
}
