import { DomainError } from '@creativo/domain/kernel';
import { PositionValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class PositionNotFoundError extends DomainError {
  readonly code = 'programs.update_position.not_found' as const;
  constructor() {
    super('No position exists with the given id');
  }
}

export class UpdatePositionValidationFailure extends DomainError {
  readonly code = 'programs.update_position.validation_failed' as const;
  constructor(public readonly errors: readonly PositionValidationError[]) {
    super('Position validation failed');
  }
}

export class UpdatePositionRepositoryFailure extends DomainError {
  readonly code = 'programs.update_position.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the updated position');
  }
}

export type UpdatePositionError =
  | PositionNotFoundError
  | UpdatePositionValidationFailure
  | UpdatePositionRepositoryFailure;
