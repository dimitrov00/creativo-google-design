import { EngagementError } from './engagement-errors.data';
import { Result } from './result.data';

/**
 * The occasion a coupon is given FOR, where it has one — a closed set, so
 * the card that dresses a grant for the day reads a fact, never a name
 * («Рожден ден −20 %» is copy an admin may reword). `birthday` is the gift a
 * client holds on their birthday. Today the tuple `COUPON_OCCASIONS =
 * ['birthday']` (`coupon.ts:64`); the stored strings are unchanged.
 */
export const CouponOccasion = {
  Birthday: 'birthday',
} as const;
export type CouponOccasion =
  (typeof CouponOccasion)[keyof typeof CouponOccasion];

/** Every occasion, dictionary order — derived, never a second source. */
export const COUPON_OCCASIONS: readonly CouponOccasion[] =
  Object.values(CouponOccasion);

/**
 * Whether a coupon is on offer — the stored `coupons.status` that replaces
 * the boolean `enabled` (§2.6 CouponEntity, §3.1: the three
 * `where('enabled', '==', true)` reads become `where('status', '==',
 * CouponStatus.Enabled)`). It sits beside the occasion: both are tags of
 * the coupon itself, not of its value or its expiry.
 */
export const CouponStatus = {
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const;
export type CouponStatus = (typeof CouponStatus)[keyof typeof CouponStatus];

export function isCouponOccasion(raw: unknown): raw is CouponOccasion {
  for (let i = 0; i < COUPON_OCCASIONS.length; i++) {
    if (COUPON_OCCASIONS[i] === raw) return true;
  }
  return false;
}

/**
 * The edge guard for a stored occasion: a missing one (`undefined`) and
 * `null` both read as "no occasion" (every coupon written before occasions
 * existed); a word the shop does not know is REFUSED — a typo must not pass
 * as "none" and quietly undress the birthday gift (`Coupon.validateOccasion`).
 */
export function parseCouponOccasion(
  raw: unknown,
): Result<CouponOccasion | null, EngagementError.CouponOccasionUnknown> {
  if (raw === undefined || raw === null) return Result.ok(null);
  return isCouponOccasion(raw)
    ? Result.ok(raw)
    : Result.err(EngagementError.couponOccasionUnknown(raw));
}
