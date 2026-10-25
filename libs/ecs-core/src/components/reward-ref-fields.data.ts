import type { CouponGrantId, GiftVoucherId } from '@core/primitives';
import type { PerkId } from './award-summary.data';

/**
 * A reward a client holds — the discriminator `rewardRef` of
 * {@link RewardRefFields} (and, as `grantRef`, of {@link GrantRefFields}).
 */
export const RewardRef = {
  CouponGrant: 'COUPON_GRANT',
  GiftVoucher: 'GIFT_VOUCHER',
  Perk: 'PERK',
  Cosmetic: 'COSMETIC',
} as const;
export type RewardRef = (typeof RewardRef)[keyof typeof RewardRef];

/** The cosmetics a reward can be — one today. Stable catalogue ids (flatten-spec §0.4). */
export const CosmeticId = {
  FrameWelcome: 'frame.welcome',
} as const;
export type CosmeticId = (typeof CosmeticId)[keyof typeof CosmeticId];

/**
 * A reward a client holds, as flat fields beside the one discriminator
 * `rewardRef` — each variant declares only its own id (the REWARD effect,
 * the REWARD_GRANTED notification).
 */
export type RewardRefFields =
  | RewardRefFields.CouponGrant
  | RewardRefFields.GiftVoucher
  | RewardRefFields.Perk
  | RewardRefFields.Cosmetic;

export const RewardRefFields = {
  couponGrant(rewardCouponGrantId: CouponGrantId): RewardRefFields.CouponGrant {
    return { rewardRef: RewardRef.CouponGrant, rewardCouponGrantId };
  },
  giftVoucher(rewardGiftVoucherId: GiftVoucherId): RewardRefFields.GiftVoucher {
    return { rewardRef: RewardRef.GiftVoucher, rewardGiftVoucherId };
  },
  perk(rewardPerkId: PerkId): RewardRefFields.Perk {
    return { rewardRef: RewardRef.Perk, rewardPerkId };
  },
  cosmetic(rewardCosmeticId: CosmeticId): RewardRefFields.Cosmetic {
    return { rewardRef: RewardRef.Cosmetic, rewardCosmeticId };
  },
} as const;

export namespace RewardRefFields {
  export type CouponGrant = {
    readonly rewardRef: typeof RewardRef.CouponGrant;
    readonly rewardCouponGrantId: CouponGrantId;
  };
  export type GiftVoucher = {
    readonly rewardRef: typeof RewardRef.GiftVoucher;
    readonly rewardGiftVoucherId: GiftVoucherId;
  };
  export type Perk = {
    readonly rewardRef: typeof RewardRef.Perk;
    readonly rewardPerkId: PerkId;
  };
  export type Cosmetic = {
    readonly rewardRef: typeof RewardRef.Cosmetic;
    readonly rewardCosmeticId: CosmeticId;
  };
}
