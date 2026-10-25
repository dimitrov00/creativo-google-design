import { describe, expect, it } from 'vitest';
import { AdjustmentId, TierId } from '@core/primitives';
import { localDate } from '@core/testing';
import { TierOverride, TierOverrideSource } from './tier-override.data';

describe('TierOverride', () => {
  it('declares the sources SCREAMING and builds each variant of the slice, "none" too', () => {
    expect(Object.values(TierOverrideSource)).toEqual(['AWARD', 'ADJUSTMENT']);
    expect(TierOverride.none()).toEqual({ tierOverrideSource: null });
    expect(
      TierOverride.award(TierId.of('gold'), null, 'rule-vip:u1:1'),
    ).toEqual({
      tierOverrideSource: 'AWARD',
      tierOverrideTierId: 'gold',
      tierOverrideUntil: null,
      tierOverrideAwardKey: 'rule-vip:u1:1',
    });
    expect(
      TierOverride.adjustment(
        TierId.of('silver'),
        localDate('2026-12-31'),
        AdjustmentId.of('adj-7'),
      ),
    ).toEqual({
      tierOverrideSource: 'ADJUSTMENT',
      tierOverrideTierId: 'silver',
      tierOverrideUntil: '2026-12-31',
      tierOverrideAdjustmentId: 'adj-7',
    });
  });
});
