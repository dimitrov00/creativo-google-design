import { EngagementError, Result } from '@core/primitives';

/**
 * The occasion a coupon is given FOR, where it has one — the coupon's field
 * `couponOccasion` (was `occasion`, N15), a closed set, so the card that
 * dresses a grant for the day reads a fact, never a name («Рожден ден −20 %»
 * is copy an admin may reword). `BIRTHDAY` is the gift a client holds on
 * their birthday. The legacy stored value was the lower-case `birthday`
 * (`coupon.ts:64`), which the legacy shims mapped until the engagement flip.
 */
export const CouponOccasion = {
  Birthday: 'BIRTHDAY',
} as const;
export type CouponOccasion =
  (typeof CouponOccasion)[keyof typeof CouponOccasion];

/** Every occasion, dictionary order — derived, never a second source. */
export const COUPON_OCCASIONS: readonly CouponOccasion[] =
  Object.values(CouponOccasion);

/**
 * Whether a coupon is on offer — the coupon's field `couponStatus` (was
 * `status`, N8), which replaces the stored boolean `enabled` (§2.6
 * Coupon, §3.1: the three `where('enabled', '==', true)` reads become
 * `where('couponStatus', '==', CouponStatus.Enabled)` in the engagement
 * flip). It sits beside the occasion: both are tags of the coupon itself,
 * not of its value or its expiry.
 */
export const CouponStatus = {
  Enabled: 'ENABLED',
  Disabled: 'DISABLED',
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
