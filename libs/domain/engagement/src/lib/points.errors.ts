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

/**
 * A deduction larger than the balance it is taken from. Refused, never
 * clamped (T2, R27): a clamp would swallow the shortfall and the ledger would
 * no longer sum. `balance` is carried so the refusal can state the most that
 * may be taken («може да се отнемат до 280 т.»).
 */
export class InsufficientPointsError extends DomainError {
  override readonly code = 'engagement.points.insufficient' as const;
  constructor(
    public readonly requested: number,
    public readonly balance: number,
  ) {
    super(`Cannot take ${requested} points from a balance of ${balance}`, {
      requested,
      balance,
    });
  }
}
