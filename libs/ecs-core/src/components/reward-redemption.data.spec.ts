import { describe, expect, it } from 'vitest';
import { RewardId } from '../entities/reward-catalog-item.entity';
import { DayKey } from './day-key.data';
import { RedeemProblem, RedemptionRecord } from './reward-redemption.data';

describe('RedeemProblem / RedemptionRecord', () => {
  it('names the seven reasons a reward stays locked, verbatim', () => {
    expect(Object.values(RedeemProblem)).toEqual([
      'disabled',
      'notYetAvailable',
      'ended',
      'soldOut',
      'paused',
      'insufficientPoints',
      'perClientLimit',
    ]);
  });

  it('records a redemption as the reward and the shop day it happened on', () => {
    expect(
      RedemptionRecord.of(RewardId.of('rw-coffee'), DayKey.of('2026-10-10')),
    ).toEqual({ rewardId: 'rw-coffee', on: '2026-10-10' });
  });
});
