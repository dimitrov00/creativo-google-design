import { type Currency, type PriceCents, Result } from '@core/primitives';
import { EngagementError } from '@core/errors';

/**
 * What a discount does to a price — the field `discountMethod`, the ONLY
 * source of these strings. The stored legacy tags are the lower-case
 * `value.kind` values (`percent_off`, `fixed_amount`, `free_service`).
 */
export const DiscountMethod = {
  /** Subtract `discountPercent` % of the price. */
  PercentOff: 'PERCENT_OFF',
  /** Subtract a fixed amount (`discountAmountCents` in `discountCurrency`). */
  FixedAmount: 'FIXED_AMOUNT',
  /** The price becomes zero. */
  FreeService: 'FREE_SERVICE',
} as const;
export type DiscountMethod =
  (typeof DiscountMethod)[keyof typeof DiscountMethod];

/**
 * What a discount actually does to a price — a flat variant slice, stored at
 * the root of `coupons/*`, snapshotted onto `couponGrants/*` and onto every
 * element of an appointment's `discounts[]` (Law 6: the legacy nested
 * `value: { kind, amount }` flattens). A `FIXED_AMOUNT` carries its own
 * `discountCurrency` beside the cents (the one place two currencies could in
 * principle differ — the bill's and the coupon's — so it is prefixed, N6).
 *
 * `FREE_SERVICE` carries nothing: it zeroes whatever is left of the price it
 * is applied to.
 */
export type CouponValue =
  CouponValue.PercentOff | CouponValue.FixedAmount | CouponValue.FreeService;

const FREE_SERVICE: CouponValue.FreeService = {
  discountMethod: DiscountMethod.FreeService,
};

export const CouponValue = {
  /** The edge guard — the only way a raw percent becomes a `PERCENT_OFF` value: 0–100 inclusive. */
  percentOff(
    percent: number,
  ): Result<
    CouponValue.PercentOff,
    EngagementError.CouponValuePercentageInvalid
  > {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return Result.err(EngagementError.couponValuePercentageInvalid(percent));
    }
    return Result.ok({
      discountMethod: DiscountMethod.PercentOff,
      discountPercent: percent,
    });
  },

  /**
   * The edge guard for a fixed amount: a positive figure — a zero-value
   * coupon is a modelling error, not a discount.
   */
  fixedAmount(
    amountCents: PriceCents,
    currency: Currency,
  ): Result<
    CouponValue.FixedAmount,
    EngagementError.CouponValueAmountNotPositive
  > {
    if (amountCents <= 0) {
      return Result.err(
        EngagementError.couponValueAmountNotPositive(amountCents),
      );
    }
    return Result.ok({
      discountMethod: DiscountMethod.FixedAmount,
      discountAmountCents: amountCents,
      discountCurrency: currency,
    });
  },

  freeService(): CouponValue.FreeService {
    return FREE_SERVICE;
  },

  /**
   * The value slice of a value that carries one — a grant, a coupon or an
   * applied discount passes straight in — copied to exactly its variant's
   * fields.
   */
  of(value: CouponValue): CouponValue {
    switch (value.discountMethod) {
      case DiscountMethod.PercentOff:
        return {
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: value.discountPercent,
        };
      case DiscountMethod.FixedAmount:
        return {
          discountMethod: DiscountMethod.FixedAmount,
          discountAmountCents: value.discountAmountCents,
          discountCurrency: value.discountCurrency,
        };
      default:
        return FREE_SERVICE;
    }
  },

  /**
   * The application order of the deterministic total order DiscountSystem
   * applies by (was `kindRank`): fixed amounts come off first, then
   * percentages bite the REDUCED remainder (15 % + 10 % is 23.5 % off, never
   * 25 %), then `FREE_SERVICE` zeroes whatever is left.
   */
  methodRank(value: CouponValue): number {
    switch (value.discountMethod) {
      case DiscountMethod.FixedAmount:
        return 0;
      case DiscountMethod.PercentOff:
        return 1;
      default:
        return 2;
    }
  },

  /**
   * The secondary sort key within one method — the "value" of the total
   * order (method rank → value → grantedAt → id). A comparison key only,
   * never an amount on its own.
   */
  magnitude(value: CouponValue): number {
    switch (value.discountMethod) {
      case DiscountMethod.PercentOff:
        return value.discountPercent;
      case DiscountMethod.FixedAmount:
        return value.discountAmountCents;
      default:
        return 0;
    }
  },
} as const;

export namespace CouponValue {
  export type PercentOff = {
    readonly discountMethod: typeof DiscountMethod.PercentOff;
    /** 0–100 inclusive — built only through `CouponValue.percentOff`. */
    readonly discountPercent: number;
  };
  export type FixedAmount = {
    readonly discountMethod: typeof DiscountMethod.FixedAmount;
    readonly discountAmountCents: PriceCents;
    readonly discountCurrency: Currency;
  };
  export type FreeService = {
    readonly discountMethod: typeof DiscountMethod.FreeService;
  };
}
