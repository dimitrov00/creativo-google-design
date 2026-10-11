import { describe, expect, it } from 'vitest';
import { Currency } from '../primitives/currency.primitive';
import { CouponId } from '../primitives/ids.primitive';
import { PriceCents } from '../primitives/price-cents.primitive';
import { unwrapOk } from '../testing';
import { PerkId } from './gamification.data';
import { RewardGrant, RewardGrantRule } from './reward-grant.data';

describe('RewardGrantRule', () => {
  it('declares what a reward mints SCREAMING (the discriminator `rewardGrant`)', () => {
    expect(Object.values(RewardGrant)).toEqual(['COUPON', 'VOUCHER', 'PERK']);
  });

  it('builds what a redeemed reward mints as flat variants, a voucher valued in cents beside its currency', () => {
    expect(RewardGrantRule.coupon(CouponId.of('coupon-free-beard'))).toEqual({
      rewardGrant: 'COUPON',
      grantCouponId: 'coupon-free-beard',
    });
    expect(
      RewardGrantRule.voucher(unwrapOk(PriceCents.of(1000)), Currency.EUR, 90),
    ).toEqual({
      rewardGrant: 'VOUCHER',
      grantVoucherCents: 1000,
      grantVoucherCurrency: 'EUR',
      grantVoucherExpiresInDays: 90,
    });
    expect(RewardGrantRule.perk(PerkId.PriorityWaitlist, null)).toEqual({
      rewardGrant: 'PERK',
      grantPerkId: 'perk.priorityWaitlist',
      grantPerkForDays: null,
    });
  });
});
