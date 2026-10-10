import { EngagementError } from './engagement-errors.data';
import type { Money } from './money.data';
import { Result } from './result.data';

/** What a discount does to a price, by kind — the stored tags, unchanged. */
export const CouponValueKind = {
  /** Subtract `percent` % of the price. */
  PercentOff: 'percent_off',
  /** Subtract a fixed `Money` amount from the price. */
  FixedAmount: 'fixed_amount',
  /** The price becomes zero. */
  FreeService: 'free_service',
} as const;
export type CouponValueKind =
  (typeof CouponValueKind)[keyof typeof CouponValueKind];

/**
 * What a discount actually does to a price — stored on `coupons/*`,
 * snapshotted onto `couponGrants/*` and onto an appointment's
 * `discounts[].value`. A `fixed_amount` carries a nested `Money` (the §2.5
 * money rule: a figure that stands alone; today the flat `amountMinorUnits`
 * + `currencyCode` of `couponValueToPersistence`).
 *
 * `free_service` carries nothing: the stored shape is `{ kind }` alone
 * (`coupon-persistence.ts:46-47`, `tools/seed/promotions.mjs:62`) — it
 * zeroes whatever is left of the price it is applied to.
 */
export type CouponValue =
  CouponValue.PercentOff | CouponValue.FixedAmount | CouponValue.FreeService;

export const CouponValue = {
  /** The edge guard — the only way a raw percent becomes a `percent_off` value: 0–100 inclusive. */
  percentOff(
    percent: number,
  ): Result<
    CouponValue.PercentOff,
    EngagementError.CouponValuePercentageInvalid
  > {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return Result.err(EngagementError.couponValuePercentageInvalid(percent));
    }
    return Result.ok({ kind: CouponValueKind.PercentOff, percent });
  },

  /**
   * The edge guard for a fixed amount: a positive figure — a zero-value
   * coupon is a modelling error, not a discount.
   */
  fixedAmount(
    amount: Money,
  ): Result<
    CouponValue.FixedAmount,
    EngagementError.CouponValueAmountNotPositive
  > {
    if (amount.amountMinorUnits <= 0) {
      return Result.err(
        EngagementError.couponValueAmountNotPositive(amount.amountMinorUnits),
      );
    }
    return Result.ok({ kind: CouponValueKind.FixedAmount, amount });
  },

  freeService(): CouponValue.FreeService {
    return { kind: CouponValueKind.FreeService };
  },

  /**
   * The application order of the deterministic total order DiscountSystem
   * applies by: fixed amounts come off first, then percentages bite the
   * REDUCED remainder (15 % + 10 % is 23.5 % off, never 25 %), then
   * `free_service` zeroes whatever is left.
   */
  kindRank(value: CouponValue): number {
    switch (value.kind) {
      case CouponValueKind.FixedAmount:
        return 0;
      case CouponValueKind.PercentOff:
        return 1;
      default:
        return 2;
    }
  },

  /**
   * The secondary sort key within one kind — the "value" of the total order
   * (kind rank → value → grantedAt → id). A comparison key only, never an
   * amount on its own.
   */
  magnitude(value: CouponValue): number {
    switch (value.kind) {
      case CouponValueKind.PercentOff:
        return value.percent;
      case CouponValueKind.FixedAmount:
        return value.amount.amountMinorUnits;
      default:
        return 0;
    }
  },
} as const;

export namespace CouponValue {
  export type PercentOff = {
    readonly kind: typeof CouponValueKind.PercentOff;
    /** 0–100 inclusive — built only through `CouponValue.percentOff`. */
    readonly percent: number;
  };
  export type FixedAmount = {
    readonly kind: typeof CouponValueKind.FixedAmount;
    readonly amount: Money;
  };
  export type FreeService = {
    readonly kind: typeof CouponValueKind.FreeService;
  };
}
