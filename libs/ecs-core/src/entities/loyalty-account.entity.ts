import type { PersonalRecord } from '../components/personal-record.data';
import type { PointsExpiry } from '../components/points-expiry.data';
import type { PunchCard } from '../components/punch-card.data';
import type { StreakState } from '../components/streak-state.data';
import type { TierState } from '../components/tier-state.data';
import type { UserId } from './user.entity';

/**
 * `loyaltyAccounts/{uid}` — one client's loyalty, the per-client projection
 * of the journal (`loyalty-document.ts:571-590`). The id is the client's
 * `UserId`; `userId` is repeated in the body because the rules and the
 * ledger query read it.
 *
 * `balance` = `lifetimeEarned + lifetimeAdjusted − lifetimeSpent`, signed:
 * negative only through a correction's compensation (the account then
 * owes), never clamped — which is why it is a plain number and not
 * `Points` (never negative). `seq` is the last journal entry folded in;
 * `version` bumps with every write.
 *
 * The one shape change (§2.6, §3.2): `streaks` is an array of states, each
 * naming its `streakId` (today a map keyed by streak id). Instants → `*Ms`.
 * Badge and season progress are subcollections, their own entities.
 */
export type LoyaltyAccountEntity = {
  readonly id: UserId;
  readonly userId: UserId;
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeAdjusted: number;
  readonly lifetimeSpent: number;
  readonly tier: TierState;
  readonly streaks: readonly StreakState[];
  readonly punchCards: readonly PunchCard[];
  readonly records: readonly PersonalRecord[];
  /** `null` while expiry is off, or when nothing can lapse. */
  readonly pointsExpiry: PointsExpiry | null;
  readonly seq: number;
  readonly version: number;
  readonly updatedAtMs: number;
};
