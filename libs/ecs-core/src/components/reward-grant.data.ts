import type { Currency, CouponId, PriceCents } from '@core/primitives';
import type { PerkId } from './award-summary.data';

/** What a redeemed reward mints — the reward's discriminator `rewardGrant`. */
export const RewardGrant = {
  Coupon: 'COUPON',
  Voucher: 'VOUCHER',
  Perk: 'PERK',
} as const;
export type RewardGrant = (typeof RewardGrant)[keyof typeof RewardGrant];

/**
 * What a redeemed catalogue reward mints (`rewardsCatalog.grants`,
 * `catalog-entries.ts`; the surviving name of §9 D21) — a variant SLICE at
 * the reward's root (today's nested `grants`): a grant of a coupon, a gift
 * voucher (its value as `grantVoucherCents` beside its own currency, N6), or
 * a perk for a while (`grantPerkForDays: null` = for good).
 */
export type RewardGrantRule =
  RewardGrantRule.Coupon | RewardGrantRule.Voucher | RewardGrantRule.Perk;

export const RewardGrantRule = {
  coupon(grantCouponId: CouponId): RewardGrantRule.Coupon {
    return { rewardGrant: RewardGrant.Coupon, grantCouponId };
  },
  voucher(
    grantVoucherCents: PriceCents,
    grantVoucherCurrency: Currency,
    grantVoucherExpiresInDays: number,
  ): RewardGrantRule.Voucher {
    return {
      rewardGrant: RewardGrant.Voucher,
      grantVoucherCents,
      grantVoucherCurrency,
      grantVoucherExpiresInDays,
    };
  },
  perk(
    grantPerkId: PerkId,
    grantPerkForDays: number | null,
  ): RewardGrantRule.Perk {
    return { rewardGrant: RewardGrant.Perk, grantPerkId, grantPerkForDays };
  },
} as const;

export namespace RewardGrantRule {
  export type Coupon = {
    readonly rewardGrant: typeof RewardGrant.Coupon;
    readonly grantCouponId: CouponId;
  };
  export type Voucher = {
    readonly rewardGrant: typeof RewardGrant.Voucher;
    /** The voucher's value, positive, beside its currency. */
    readonly grantVoucherCents: PriceCents;
    readonly grantVoucherCurrency: Currency;
    /** Whole days from issue, at least 1. */
    readonly grantVoucherExpiresInDays: number;
  };
  export type Perk = {
    readonly rewardGrant: typeof RewardGrant.Perk;
    readonly grantPerkId: PerkId;
    /** `null` = for good. */
    readonly grantPerkForDays: number | null;
  };
}
