import type { RewardId, LocalDate } from '@core/primitives';

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
