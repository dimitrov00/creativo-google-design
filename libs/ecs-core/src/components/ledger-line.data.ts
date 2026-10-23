/**
 * What one row of «Движение» is about (client-card-revision-3 §2.2.5) —
 * the ONLY source of these strings (Law 1, Law 6.2), the field
 * `ledgerLine: LedgerLine` of `LedgerSystem.lineOf`'s answer. One tag per
 * kind of row the ledger words, decided from the event's leading entry:
 *
 * - `REVERSAL` — a row that compensates another (or a redemption taken
 *   back);
 * - `REDEMPTION_SPENT` / `REDEMPTION_EXPIRED` — a reward taken for points,
 *   or one that lapsed unused;
 * - `REWARD_GRANTED` / `REWARD_REVOKED` — a reward given, or taken back;
 * - `TIER` — a new status;
 * - `LEVEL` — a level of a family (with or without the points it paid);
 * - `VISIT_EARNED` — the points a visit earned;
 * - `POINTS_REDEEMED`, `GOODWILL`, `SERVICE_ISSUE`, `POINTS_EXPIRED`,
 *   `DEBT_CLEARED` — a point row by what its label says moved the points;
 * - `CORRECTION` — any other point row (the default).
 *
 * The words, glyphs and tones of each are the presenter's one table.
 */
export const LedgerLine = {
  Reversal: 'REVERSAL',
  RedemptionSpent: 'REDEMPTION_SPENT',
  RedemptionExpired: 'REDEMPTION_EXPIRED',
  RewardGranted: 'REWARD_GRANTED',
  RewardRevoked: 'REWARD_REVOKED',
  Tier: 'TIER',
  Level: 'LEVEL',
  VisitEarned: 'VISIT_EARNED',
  PointsRedeemed: 'POINTS_REDEEMED',
  Goodwill: 'GOODWILL',
  ServiceIssue: 'SERVICE_ISSUE',
  PointsExpired: 'POINTS_EXPIRED',
  DebtCleared: 'DEBT_CLEARED',
  Correction: 'CORRECTION',
} as const;
export type LedgerLine = (typeof LedgerLine)[keyof typeof LedgerLine];
