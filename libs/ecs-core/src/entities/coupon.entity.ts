import type { CouponCombinability } from '../components/coupon-combinability.data';
import type { CouponExpiry } from '../components/coupon-expiry.data';
import type {
  CouponOccasion,
  CouponStatus,
} from '../components/coupon-occasion.data';
import type { CouponValue } from '../components/coupon-value.data';
import type { VoucherCode } from '../components/voucher-code.data';

export type CouponId = string & { readonly __brand: unique symbol };
export const CouponId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): CouponId => raw as CouponId,
} as const;

/**
 * `coupons/{id}` — an admin-configured discount blueprint (value, expiry,
 * usage policy); granting one to a user creates a `couponGrants` document.
 * The stored body of `couponToPersistence` (`coupon-persistence.ts:119-130`),
 * every field written, the "none" ones `null`. Declared changes (§2.6):
 * `enabled` → `status: CouponStatus`, `expiry.atIso` → `atMs`, and a
 * `fixed_amount` value's amount nested as `Money`.
 */
export type CouponEntity = {
  readonly id: CouponId;
  /** Trimmed, never blank. */
  readonly name: string;
  /**
   * A SHAREABLE code that opens the coupon at the counter (`FIRST10`),
   * stored upper-case; `null` for a coupon that reaches people only as grants.
   */
  readonly code: VoucherCode | null;
  readonly value: CouponValue;
  readonly combinability: CouponCombinability;
  readonly expiry: CouponExpiry;
  /** A positive whole number, or `null` = unlimited. */
  readonly usageLimit: number | null;
  readonly status: CouponStatus;
  /** What the coupon is given for; `null` for one tied to no occasion. */
  readonly occasion: CouponOccasion | null;
};
