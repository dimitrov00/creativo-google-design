import { DomainError } from '@creativo/domain/kernel';

export class InvalidPointsError extends DomainError {
  override readonly code = 'engagement.points.invalid' as const;
  constructor(public readonly attempted: number) {
    super(
      `${attempted} is not a valid points amount (must be a non-negative integer)`,
      {
        attempted,
      },
    );
  }
}
