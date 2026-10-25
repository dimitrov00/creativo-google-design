/**
 * The occasion a coupon is given FOR, where it has one — the coupon's field
 * `couponOccasion` (was `occasion`, N15), a closed set, so the card that
 * dresses a grant for the day reads a fact, never a name («Рожден ден −20 %»
 * is copy an admin may reword). `BIRTHDAY` is the gift a client holds on
 * their birthday.
 */
export const CouponOccasion = {
  Birthday: 'BIRTHDAY',
} as const;
export type CouponOccasion =
  (typeof CouponOccasion)[keyof typeof CouponOccasion];
