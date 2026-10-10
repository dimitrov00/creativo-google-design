import { EngagementError } from './engagement-errors.data';
import { Result } from './result.data';

/** When a grant from a coupon stops being usable, by kind — the stored tags, unchanged. */
export const CouponExpiryKind = {
  Never: 'never',
  /** A RELATIVE policy: N days after granting. */
  Days: 'days',
  /** An absolute moment. */
  FixedDate: 'fixed_date',
} as const;
export type CouponExpiryKind =
  (typeof CouponExpiryKind)[keyof typeof CouponExpiryKind];

const MS_PER_DAY = 86_400_000;

/**
 * When does a grant from this coupon stop being usable? `days` is relative
 * (N days after granting), `fixed_date` an absolute instant — `coupon.ts:
 * 23-54`, with the declared `atIso` → `atMs` change (§2.6 CouponEntity).
 */
export type CouponExpiry =
  CouponExpiry.Never | CouponExpiry.Days | CouponExpiry.FixedDate;

export const CouponExpiry = {
  never(): CouponExpiry.Never {
    return { kind: CouponExpiryKind.Never };
  },

  /** The edge guard: a positive whole number of days. */
  days(
    days: number,
  ): Result<CouponExpiry.Days, EngagementError.CouponExpiryDaysInvalid> {
    if (!Number.isInteger(days) || days <= 0) {
      return Result.err(EngagementError.couponExpiryDaysInvalid(days));
    }
    return Result.ok({ kind: CouponExpiryKind.Days, days });
  },

  fixedDate(atMs: number): CouponExpiry.FixedDate {
    return { kind: CouponExpiryKind.FixedDate, atMs };
  },

  /**
   * Whether a grant granted at `grantedAtMs` is still within this expiry at
   * `nowMs` — both ends inclusive (`isSameOrBefore`). `days` counts whole
   * 24-hour days of elapsed time from the grant (`plusMinutes(days·24·60)`),
   * never calendar days, so no zone is involved.
   */
  isWithin(expiry: CouponExpiry, grantedAtMs: number, nowMs: number): boolean {
    switch (expiry.kind) {
      case CouponExpiryKind.Days:
        return nowMs <= grantedAtMs + expiry.days * MS_PER_DAY;
      case CouponExpiryKind.FixedDate:
        return nowMs <= expiry.atMs;
      default:
        return true;
    }
  },
} as const;

export namespace CouponExpiry {
  export type Never = { readonly kind: typeof CouponExpiryKind.Never };
  export type Days = {
    readonly kind: typeof CouponExpiryKind.Days;
    /** A positive whole number — built only through `CouponExpiry.days`. */
    readonly days: number;
  };
  export type FixedDate = {
    readonly kind: typeof CouponExpiryKind.FixedDate;
    readonly atMs: number;
  };
}
