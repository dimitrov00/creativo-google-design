import type { RewardId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';

/**
 * Why a reward cannot be redeemed now — the one gate, shared by the redeem
 * callable and the card's lock line (`standing.ts:319-391`). The ONLY
 * source of these strings.
 */
export const RedeemProblem = {
  Disabled: 'DISABLED',
  NotYetAvailable: 'NOT_YET_AVAILABLE',
  Ended: 'ENDED',
  SoldOut: 'SOLD_OUT',
  Paused: 'PAUSED',
  InsufficientPoints: 'INSUFFICIENT_POINTS',
  PerClientLimit: 'PER_CLIENT_LIMIT',
} as const;
export type RedeemProblem = (typeof RedeemProblem)[keyof typeof RedeemProblem];

/** One of the client's non-reversed redemptions, as the per-client limit counts it. */
export type RedemptionRecord = {
  readonly rewardId: RewardId;
  readonly on: LocalDate;
};

export const RedemptionRecord = {
  of(rewardId: RewardId, on: LocalDate): RedemptionRecord {
    return { rewardId, on };
  },
} as const;
