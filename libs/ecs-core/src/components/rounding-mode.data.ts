/*
 * Split out of `money.data.ts` (pass D, S-21; L-1): `RoundingMode` types no
 * `Money` field — only `Money.scale`'s `mode` PARAMETER — so it is its own
 * dictionary file, values unchanged.
 */

/**
 * How `Money.scale` resolves a quotient that falls between two minor units;
 * an exact quotient never rounds. Each member states its own rule. History:
 * the names match dinero.js v2's divide functions (`down`, `up`, `halfUp`,
 * `halfDown`, `halfEven`, `halfTowardsZero`, `halfAwayFromZero`), which the
 * money spec held them to until Phase 4b removed the package; its recorded
 * answers stay pinned there as a golden tie-and-sign table.
 */
export const RoundingMode = {
  /** Floor: always toward −∞, whatever the remainder (2.5 → 2, −2.5 → −3). */
  Floor: 'FLOOR',
  /** Ceil: always toward +∞, whatever the remainder (2.5 → 3, −2.5 → −2). */
  Ceil: 'CEIL',
  /**
   * Half-up: nearest; a tie goes toward +∞, as `Math.round` does
   * (2.5 → 3, −2.5 → −2).
   */
  HalfUp: 'HALF_UP',
  /** Half-down: nearest; a tie goes toward −∞ (2.5 → 2, −2.5 → −3). */
  HalfDown: 'HALF_DOWN',
  /**
   * Half-even: nearest; a tie goes to the even neighbour — banker's
   * rounding (2.5 → 2, 3.5 → 4, −2.5 → −2).
   */
  HalfEven: 'HALF_EVEN',
  /** Half toward zero: nearest; a tie goes toward zero (2.5 → 2, −2.5 → −2). */
  HalfTowardsZero: 'HALF_TOWARDS_ZERO',
  /**
   * Half away from zero: nearest; a tie goes away from zero — commercial
   * rounding (2.5 → 3, −2.5 → −3).
   */
  HalfAwayFromZero: 'HALF_AWAY_FROM_ZERO',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];
