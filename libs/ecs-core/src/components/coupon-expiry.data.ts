import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { EngagementError } from './engagement-errors.data';
import { Result } from './result.data';

/**
 * When a grant from a coupon stops being usable — the field `couponExpiry`,
 * the ONLY source of these strings. The stored legacy tags are the
 * lower-case `expiry.kind` values (`never`, `days`, `fixed_date`).
 */
export const CouponExpiry = {
  Never: 'NEVER',
  /** A RELATIVE policy: N days after granting. */
  Days: 'DAYS',
  /** An absolute moment. */
  FixedDate: 'FIXED_DATE',
} as const;
export type CouponExpiry = (typeof CouponExpiry)[keyof typeof CouponExpiry];

/**
 * When does a grant from this coupon stop being usable? A flat variant
 * slice of the `Coupon` archetype (`coupon.ts:23-54`): `DAYS` is relative
 * (`expiryDays` after granting), `FIXED_DATE` an absolute instant
 * (`expiresAtUtcMs`).
 */
export type CouponExpiryRule =
  CouponExpiryRule.Never | CouponExpiryRule.Days | CouponExpiryRule.FixedDate;

const NEVER: CouponExpiryRule.Never = { couponExpiry: CouponExpiry.Never };

export const CouponExpiryRule = {
  never(): CouponExpiryRule.Never {
    return NEVER;
  },

  /** The edge guard: a positive whole number of days. */
  days(
    days: number,
  ): Result<CouponExpiryRule.Days, EngagementError.CouponExpiryDaysInvalid> {
    if (!Number.isInteger(days) || days <= 0) {
      return Result.err(EngagementError.couponExpiryDaysInvalid(days));
    }
    return Result.ok({ couponExpiry: CouponExpiry.Days, expiryDays: days });
  },

  fixedDate(atUtcMs: UtcEpochMs): CouponExpiryRule.FixedDate {
    return { couponExpiry: CouponExpiry.FixedDate, expiresAtUtcMs: atUtcMs };
  },

  /**
   * Whether a grant granted at `grantedAtUtcMs` is still within this expiry
   * at `nowUtcMs` — both ends inclusive. `DAYS` counts whole 24-hour days of
   * ELAPSED time from the grant, never calendar days, so no zone is involved
   * (a T2 lifecycle comparison, G-1).
   */
  isWithin(
    rule: CouponExpiryRule,
    grantedAtUtcMs: UtcEpochMs,
    nowUtcMs: UtcEpochMs,
  ): boolean {
    switch (rule.couponExpiry) {
      case CouponExpiry.Days:
        return (
          UtcEpochMs.compare(
            nowUtcMs,
            UtcEpochMs.plusDays(grantedAtUtcMs, rule.expiryDays),
          ) <= 0
        );
      case CouponExpiry.FixedDate:
        return UtcEpochMs.compare(nowUtcMs, rule.expiresAtUtcMs) <= 0;
      default:
        return true;
    }
  },
} as const;

export namespace CouponExpiryRule {
  export type Never = { readonly couponExpiry: typeof CouponExpiry.Never };
  export type Days = {
    readonly couponExpiry: typeof CouponExpiry.Days;
    /** A positive whole number — built only through `CouponExpiryRule.days`. */
    readonly expiryDays: number;
  };
  export type FixedDate = {
    readonly couponExpiry: typeof CouponExpiry.FixedDate;
    readonly expiresAtUtcMs: UtcEpochMs;
  };
}
