import { describe, expect, it } from 'vitest';
import type { CouponId } from '../entities/coupon.entity';
import { RewardGrant, RewardGrantKind } from './reward-grant.data';

describe('RewardGrant', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(RewardGrantKind)).toEqual([
      'coupon',
      'voucher',
      'perk',
    ]);
  });

  it('builds what a redeemed reward mints, a voucher valued in Money', () => {
    expect(RewardGrant.coupon('coupon-free-beard' as CouponId)).toEqual({
      kind: 'coupon',
      couponId: 'coupon-free-beard',
    });
    expect(
      RewardGrant.voucher({ amountMinorUnits: 1000, currencyCode: 'EUR' }, 90),
    ).toEqual({
      kind: 'voucher',
      amount: { amountMinorUnits: 1000, currencyCode: 'EUR' },
      expiresInDays: 90,
    });
    expect(RewardGrant.perk('perk.priorityWaitlist', null)).toEqual({
      kind: 'perk',
      perkId: 'perk.priorityWaitlist',
      forDays: null,
    });
  });
});
