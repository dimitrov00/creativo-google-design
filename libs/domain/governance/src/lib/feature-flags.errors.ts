import { DomainError } from '@creativo/domain/kernel';

export class UnknownFeatureFlagKeyError extends DomainError {
  override readonly code = 'governance.feature_flags.unknown_key' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a known feature flag key`, {
      attempted,
    });
  }
}

export class InvalidFeatureFlagValueError extends DomainError {
  override readonly code = 'governance.feature_flags.invalid_value' as const;
  constructor(public readonly key: string) {
    super(`Feature flag "${key}" must be a boolean`, { key });
  }
}

export type FeatureFlagsValidationError =
  UnknownFeatureFlagKeyError | InvalidFeatureFlagValueError;
