import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

export class EmptyMediaPathError extends DomainError {
  readonly code = 'catalog.media_ref.empty_path' as const;
  constructor() {
    super('Media path cannot be empty');
  }
}

export class InvalidMediaDimensionError extends DomainError {
  readonly code = 'catalog.media_ref.invalid_dimension' as const;
  constructor(
    public readonly dimension: 'width' | 'height',
    public readonly rawValue: number,
  ) {
    super(`Media ${dimension} must be a positive integer: ${rawValue}`, {
      dimension,
      rawValue,
    });
  }
}

export class FocalPointOutOfRangeError extends DomainError {
  readonly code = 'catalog.media_ref.focal_point_out_of_range' as const;
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    super(`Focal point must be normalized to 0..1 on both axes: (${x}, ${y})`, {
      x,
      y,
    });
  }
}

export type MediaRefValidationError =
  | EmptyIdError
  | EmptyMediaPathError
  | InvalidMediaDimensionError
  | FocalPointOutOfRangeError;
