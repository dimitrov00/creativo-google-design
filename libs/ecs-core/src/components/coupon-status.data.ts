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
