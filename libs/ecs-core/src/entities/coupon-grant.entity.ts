import type { CouponValue } from '../components/coupon-value.data';
import type { GrantStatus } from '../components/grant-status.data';
import type { CouponId } from './coupon.entity';
import type { UserId } from './user.entity';

export type CouponGrantId = string & { readonly __brand: unique symbol };
export const CouponGrantId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): CouponGrantId => raw as CouponGrantId,
} as const;

/**
 * `couponGrants/{id}` — a user's instance of a discount, granted from a
 * coupon. `value` is the coupon's value snapshotted at granting; `state` is
 * the stored lifecycle union (the key is `state`, `firestore.rules:198`).
 * `grantedAt` → `grantedAtMs`, `*AtIso` → `*AtMs`, a `fixed_amount`
 * amount nested as `Money`, and nothing else (§2.6).
 */
export type CouponGrantEntity = {
  readonly id: CouponGrantId;
  readonly userId: UserId;
  readonly couponId: CouponId;
  readonly value: CouponValue;
  readonly grantedAtMs: number;
  readonly state: GrantStatus;
};
