import type { Combinability } from '../components/coupon-combinability.data';
import type { CouponExpiryRule } from '../components/coupon-expiry.data';
import type {
  CouponOccasion,
  CouponStatus,
} from '../components/coupon-occasion.data';
import type { CouponValue } from '../components/coupon-value.data';
import type { VoucherCode } from '../components/voucher-code.data';
import type { CouponId } from '../primitives/ids.primitive';

/*
 * F0 STAGING: `CouponId` lives in `primitives/ids.primitive.ts` (§1.5); the
 * barrel still names this file for it until the integrator drops that line.
 */

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
