import type {
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  VoucherCode,
} from '@core/components';
import type { CouponId } from '@core/primitives';

/** The coupon's identity slice — its id and plain 1-to-1 attributes. */
export type CouponMeta = {
  readonly id: CouponId;
  /** Trimmed, never blank. */
  readonly name: string;
  /**
   * A SHAREABLE code that opens the coupon at the counter (`FIRST10`),
   * stored upper-case; `null` for a coupon that reaches people only as grants.
   */
  readonly code: VoucherCode | null;
  readonly combinability: Combinability;
  /** A positive whole number, or `null` = unlimited. */
  readonly usageLimit: number | null;
  /** Was `status` (N8). */
  readonly couponStatus: CouponStatus;
  /** What the coupon is given for; `null` for one tied to no occasion. Was `occasion` (N15). */
  readonly couponOccasion: CouponOccasion | null;
};

/**
 * `coupons/{id}` — an admin-configured discount blueprint (value, expiry,
 * usage policy); granting one to a user creates a `couponGrants` document.
 * The flat intersection of its slices (Law 6): the identity slice, the
 * `CouponValue` slice (was the nested `value`) and the `CouponExpiryRule`
 * slice (was the nested `expiry`).
 */
export type Coupon = CouponMeta & CouponValue & CouponExpiryRule;
