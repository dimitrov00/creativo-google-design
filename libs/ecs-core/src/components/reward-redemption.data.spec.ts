import { describe, expect, it } from 'vitest';
import { RewardId } from '@core/primitives';
import { localDate } from '@core/testing';
import { RedeemProblem } from './redeem-problem.data';
import { RedemptionRecord } from './reward-redemption.data';

describe('RedeemProblem / RedemptionRecord', () => {
  it('names the seven reasons a reward stays locked, SCREAMING', () => {
    expect(Object.values(RedeemProblem)).toEqual([
      'DISABLED',
      'NOT_YET_AVAILABLE',
      'ENDED',
      'SOLD_OUT',
      'PAUSED',
      'INSUFFICIENT_POINTS',
      'PER_CLIENT_LIMIT',
    ]);
  });

  it('records a redemption as the reward and the shop day it happened on', () => {
    expect(
      RedemptionRecord.of(RewardId.of('rw-coffee'), localDate('2026-10-10')),
    ).toEqual({ rewardId: 'rw-coffee', on: '2026-10-10' });
  });
});
