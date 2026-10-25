import type { CouponGrantId, GiftVoucherId } from '@core/primitives';
import type { PerkId } from './award-summary.data';
import { type CosmeticId, RewardRef } from './reward-ref-fields.data';

/**
 * What a redemption minted — today's nullable `grant` ref as a variant
 * SLICE (F-26) on `grantRef` (`null` = nothing minted yet): every variant
 * narrows, never four independent nullable ids.
 */
export type GrantRefFields =
  | GrantRefFields.None
  | GrantRefFields.CouponGrant
  | GrantRefFields.GiftVoucher
  | GrantRefFields.Perk
  | GrantRefFields.Cosmetic;

export const GrantRefFields = {
  none(): GrantRefFields.None {
    return { grantRef: null };
  },
  couponGrant(grantCouponGrantId: CouponGrantId): GrantRefFields.CouponGrant {
    return { grantRef: RewardRef.CouponGrant, grantCouponGrantId };
  },
  giftVoucher(grantGiftVoucherId: GiftVoucherId): GrantRefFields.GiftVoucher {
    return { grantRef: RewardRef.GiftVoucher, grantGiftVoucherId };
  },
  perk(grantPerkId: PerkId): GrantRefFields.Perk {
    return { grantRef: RewardRef.Perk, grantPerkId };
  },
  cosmetic(grantCosmeticId: CosmeticId): GrantRefFields.Cosmetic {
    return { grantRef: RewardRef.Cosmetic, grantCosmeticId };
  },
} as const;

export namespace GrantRefFields {
  export type None = { readonly grantRef: null };
  export type CouponGrant = {
    readonly grantRef: typeof RewardRef.CouponGrant;
    readonly grantCouponGrantId: CouponGrantId;
  };
  export type GiftVoucher = {
    readonly grantRef: typeof RewardRef.GiftVoucher;
    readonly grantGiftVoucherId: GiftVoucherId;
  };
  export type Perk = {
    readonly grantRef: typeof RewardRef.Perk;
    readonly grantPerkId: PerkId;
  };
  export type Cosmetic = {
    readonly grantRef: typeof RewardRef.Cosmetic;
    readonly grantCosmeticId: CosmeticId;
  };
}
