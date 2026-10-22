import type {
  PersonalRecord,
  PointsExpiry,
  PunchCard,
  StreakState,
  TierState,
} from '@core/components';
import type { CustomerId, UtcEpochMs } from '@core/primitives';

/**
 * The account's identity slice: the client record, the points ledger's
 * sums, the 1-to-N projections (each an array of flat structs) and the
 * bookkeeping.
 *
 * `balance` = `lifetimeEarned + lifetimeAdjusted − lifetimeSpent`, signed:
 * negative only through a correction's compensation (the account then
 * owes), never clamped — which is why it is a plain number and not
 * `Points` (never negative). `streaks` holds one state per rhythm, each
 * naming its `streakId` — found by `StreakState.find`, never by a map key.
 * `seq` is the last journal entry folded in; `version` bumps with every
 * write. `id` and `customerId` are the client RECORD the loyalty rewards
 * (D29) — never an account's uid.
 */
export type LoyaltyAccountMeta = {
  readonly id: CustomerId;
  readonly customerId: CustomerId;
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
 * `loyaltyAccounts/{customerId}` — one client record's loyalty, the
 * per-client projection of the journal. `customerId` is repeated in the
 * body beside the document id, as every flat archetype keeps its key. Read
 * by staff only (the client card, `worksTheBook()`), through the record
 * the card resolved; written by the dev seed until the loyalty engine
 * lands (D14).
 *
 * The archetype (Law 6): the identity slice, the tier (the `TierState`
 * slice — the computed standing and the override variant) and the points
 * expiry (the `PointsExpiry` slice), every 1-to-1 field at the root. Badge
 * and season progress are subcollections, their own entities.
 */
export type LoyaltyAccount = LoyaltyAccountMeta & TierState & PointsExpiry;
