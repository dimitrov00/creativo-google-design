import { Points } from './points';
import { CouponId } from './ids';

/**
 * A reward that can be granted to a user (ports v2's `Reward.ts`).
 * Discriminated union by `kind` — the runtime payload depends on the
 * variant, all pure data.
 *
 * Deviation from v2: the `badge` variant is dropped for this pass —
 * badge-granting is folded entirely into `Achievement` (this context's
 * unlock mechanism already carries its own reward set), avoiding two
 * parallel badge-granting paths.
 */
export type Reward = RewardPointsAward | RewardCoupon;

export interface RewardPointsAward {
  readonly kind: 'points';
  readonly amount: Points;
}

export interface RewardCoupon {
  readonly kind: 'coupon';
  readonly couponId: CouponId;
}

export const Reward = {
  points(amount: Points): RewardPointsAward {
    return { kind: 'points', amount };
  },
  coupon(couponId: CouponId): RewardCoupon {
    return { kind: 'coupon', couponId };
  },
} as const;
