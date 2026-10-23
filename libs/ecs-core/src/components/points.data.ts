import { type Brand, Result } from '@core/primitives';
import { EngagementError } from '@core/errors';

/**
 * Whole reward points, never negative — a brand over the plain number
 * (`points.ts`, §2.7). `sub` REFUSES an over-spend rather than clamping it
 * (T2, R27): a clamp makes the shortfall vanish, and a ledger whose entries
 * no longer sum to its balance cannot be audited or reversed. A cascade
 * that genuinely leaves a client in debt shows as the account's signed
 * `balance` (`LoyaltyAccount`), never as a `Points` value.
 */
export type Points = Brand<number, 'Points'>;

export const Points = {
  /** The only cast site, for a figure already validated (a stored document). Untrusted input goes through `parse`. */
  of(raw: number): Points {
    return raw as Points;
  },

  /** The edge guard — the only way a raw number becomes points: a non-negative integer. */
  parse(raw: number): Result<Points, EngagementError.PointsInvalid> {
    return Number.isInteger(raw) && raw >= 0
      ? Result.ok(Points.of(raw + 0))
      : Result.err(EngagementError.pointsInvalid(raw));
  },

  zero(): Points {
    return Points.of(0);
  },

  add(a: Points, b: Points): Points {
    return Points.of(a + b);
  },

  /** `from − take`, or a refusal naming the most that may be taken. */
  sub(
    from: Points,
    take: Points,
  ): Result<Points, EngagementError.PointsInsufficient> {
    return take > from
      ? Result.err(EngagementError.pointsInsufficient(take, from))
      : Result.ok(Points.of(from - take));
  },
} as const;
