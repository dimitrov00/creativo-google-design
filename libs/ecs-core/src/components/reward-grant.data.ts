import type { CouponId } from '../entities/coupon.entity';
import type { PerkId } from './gamification.data';
import type { Money } from './money.data';

/** What a redeemed reward mints, by kind — the stored `grants.kind` tags, unchanged. */
export const RewardGrantKind = {
  Coupon: 'coupon',
  Voucher: 'voucher',
  Perk: 'perk',
} as const;
export type RewardGrantKind =
  (typeof RewardGrantKind)[keyof typeof RewardGrantKind];

/**
 * What a redeemed catalogue reward mints (`rewardsCatalog.grants`,
 * `catalog-entries.ts`; the surviving name of §9 D21): a grant of a coupon,
 * a gift voucher, or a perk for a while (`forDays: null` = for good).
 *
 * Declared change: a voucher's value is a nested `Money` (`amount`) — the
 * §2.5 money rule for a figure that stands alone and the law's
 * `*MinorUnits` + `currencyCode` vocabulary — where today it is the bare
 * `amountMinor` with no currency (`loyalty-document.ts:316`).
 */
export type RewardGrant =
  RewardGrant.Coupon | RewardGrant.Voucher | RewardGrant.Perk;

export const RewardGrant = {
  coupon(couponId: CouponId): RewardGrant.Coupon {
    return { kind: RewardGrantKind.Coupon, couponId };
  },
  voucher(amount: Money, expiresInDays: number): RewardGrant.Voucher {
    return { kind: RewardGrantKind.Voucher, amount, expiresInDays };
  },
  perk(perkId: PerkId, forDays: number | null): RewardGrant.Perk {
    return { kind: RewardGrantKind.Perk, perkId, forDays };
  },
} as const;

export namespace RewardGrant {
  export type Coupon = {
    readonly kind: typeof RewardGrantKind.Coupon;
    readonly couponId: CouponId;
  };
  export type Voucher = {
    readonly kind: typeof RewardGrantKind.Voucher;
    /** The voucher's value, positive. */
    readonly amount: Money;
    /** Whole days from issue, at least 1. */
    readonly expiresInDays: number;
  };
  export type Perk = {
    readonly kind: typeof RewardGrantKind.Perk;
    readonly perkId: PerkId;
    /** `null` = for good. */
    readonly forDays: number | null;
  };
}
