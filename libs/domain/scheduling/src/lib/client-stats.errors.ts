import { DomainError } from '@creativo/domain/kernel';

export class InvalidClientStatsPolicyError extends DomainError {
  override readonly code = 'scheduling.client_stats_policy.invalid' as const;
  constructor(
    public readonly field: string,
    public readonly rawValue: number,
  ) {
    super(`Client stats policy "${field}" is invalid: ${rawValue}`, {
      field,
      rawValue,
    });
  }
}
