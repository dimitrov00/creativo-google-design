import type { RewardId } from '../entities/reward-catalog-item.entity';
import type { DayKey } from './day-key.data';

/**
 * Why a reward cannot be redeemed now — the one gate, shared by the redeem
 * callable and the card's lock line (`standing.ts:319-391`). The ONLY
 * source of these strings.
 */
export const RedeemProblem = {
  Disabled: 'disabled',
  NotYetAvailable: 'notYetAvailable',
  Ended: 'ended',
  SoldOut: 'soldOut',
  Paused: 'paused',
  InsufficientPoints: 'insufficientPoints',
  PerClientLimit: 'perClientLimit',
} as const;
export type RedeemProblem = (typeof RedeemProblem)[keyof typeof RedeemProblem];

/** One of the client's non-reversed redemptions, as the per-client limit counts it. */
export type RedemptionRecord = {
  readonly rewardId: RewardId;
  readonly on: DayKey;
};

export const RedemptionRecord = {
  of(rewardId: RewardId, on: DayKey): RedemptionRecord {
    return { rewardId, on };
  },
} as const;
