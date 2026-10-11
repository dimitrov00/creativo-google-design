import type {
  PersonalRecord,
  PointsExpiry,
  PunchCard,
  StreakState,
  TierState,
} from '@core/components';
import type { UserId, UtcEpochMs } from '@core/primitives';

/**
 * The account's identity slice: the client, the points ledger's sums, the
 * 1-to-N projections (each an array of flat structs) and the bookkeeping.
 *
 * `balance` = `lifetimeEarned + lifetimeAdjusted − lifetimeSpent`, signed:
 * negative only through a correction's compensation (the account then
 * owes), never clamped — which is why it is a plain number and not
 * `Points` (never negative). `seq` is the last journal entry folded in;
 * `version` bumps with every write. `id` and `userId` keep their `UserId`
 * until the loyalty flip (3) re-keys the account (D29, §5.5).
 */
export type LoyaltyAccountMeta = {
  readonly id: UserId;
  readonly userId: UserId;
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeAdjusted: number;
  readonly lifetimeSpent: number;
  readonly streaks: readonly StreakState[];
  readonly punchCards: readonly PunchCard[];
  readonly records: readonly PersonalRecord[];
  readonly seq: number;
  readonly version: number;
  readonly updatedAtUtcMs: UtcEpochMs;
};

/**
 * `loyaltyAccounts/{uid}` — one client's loyalty, the per-client projection
 * of the journal (`loyalty-document.ts:571-590`). `userId` is repeated in
 * the body because the rules and the ledger query read it.
 *
 * The archetype (Law 6): the identity slice, the tier (the `TierState`
 * slice — the computed standing and the override variant, was `tier`) and
 * the points expiry (the `PointsExpiry` slice, was `pointsExpiry`), every
 * 1-to-1 field at the root. Badge and season progress are subcollections,
 * their own entities.
 */
export type LoyaltyAccount = LoyaltyAccountMeta & TierState & PointsExpiry;
