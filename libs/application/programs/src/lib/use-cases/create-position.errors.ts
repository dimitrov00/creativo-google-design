import { DomainError } from '@creativo/domain/kernel';
import { PositionValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class CreatePositionValidationFailure extends DomainError {
  readonly code = 'programs.create_position.validation_failed' as const;
  constructor(public readonly errors: readonly PositionValidationError[]) {
    super('Position validation failed');
  }
}

export class CreatePositionRepositoryFailure extends DomainError {
  readonly code = 'programs.create_position.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new position');
  }
}

export type CreatePositionError =
  CreatePositionValidationFailure | CreatePositionRepositoryFailure;
