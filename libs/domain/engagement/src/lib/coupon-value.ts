import { Money, Result, fail, ok } from '@creativo/domain/kernel';
import {
  InvalidCouponPercentageError,
  NegativeCouponAmountError,
} from './coupon-value.errors';

/**
 * What a discount actually does to a price. Discriminated union by
 * `kind` (ports v2's `CouponValue.ts`) — a percentage-vs-fixed-amount
 * shape, per-variant payload named for what it represents so
 * destructuring `{ percent }` vs `{ amount }` reads intent at the call
 * site. Per the migration blueprint's guidance for this context: no
 * separate shared `Percentage` VO is ported — `percent` is validated
 * inline by the one `percentOff()` door below (the primitive-obsession
 * ban's factory carve-out), consistent with `Money` (from kernel) being
 * the sole minor-unit amount type.
 *
 *   - `percent_off`   — subtract `percent`% of the price
 *   - `fixed_amount`  — subtract a fixed `Money` amount from the price
 *   - `free_service`  — price becomes zero
 */
export type CouponValue =
  CouponValuePercentOff | CouponValueFixedAmount | CouponValueFreeService;

export interface CouponValuePercentOff {
  readonly kind: 'percent_off';
  /** 0-100 inclusive — only ever constructed via `CouponValue.percentOff()`. */
  readonly percent: number;
}

export interface CouponValueFixedAmount {
  readonly kind: 'fixed_amount';
  readonly amount: Money;
}

export interface CouponValueFreeService {
  readonly kind: 'free_service';
}

const FREE_SERVICE: CouponValueFreeService = { kind: 'free_service' };

export const CouponValue = {
  /** Validating factory — the ONLY way a raw percent number becomes a `percent_off` value. */
  percentOff(
    percent: number,
  ): Result<CouponValuePercentOff, InvalidCouponPercentageError> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return fail(new InvalidCouponPercentageError(percent));
    }
    return ok({ kind: 'percent_off', percent });
  },

  /** Validating factory — rejects a non-positive amount (a zero-value coupon is a modeling error, not a valid discount). */
  fixedAmount(
    amount: Money,
  ): Result<CouponValueFixedAmount, NegativeCouponAmountError> {
    if (amount.toMinorUnits() <= 0) {
      return fail(new NegativeCouponAmountError());
    }
    return ok({ kind: 'fixed_amount', amount });
  },

  freeService(): CouponValueFreeService {
    return FREE_SERVICE;
  },

  /**
   * Application order rank for the §7.4 deterministic total order used by
   * `DiscountApplication.apply()`: fixed amounts come off first, then
   * percentages bite the *reduced* remainder (so 15% + 10% is 23.5% off,
   * never 25%), then `free_service` zeroes whatever is left.
   */
  kindRank(value: CouponValue): number {
    switch (value.kind) {
      case 'fixed_amount':
        return 0;
      case 'percent_off':
        return 1;
      case 'free_service':
        return 2;
    }
  },

  /**
   * Secondary sort key within the same `kind` — the "value" component of
   * the §7.4 total order (kind rank → value → grantedAt → id). Purely a
   * comparison key, never a domain amount on its own.
   */
  magnitude(value: CouponValue): number {
    switch (value.kind) {
      case 'percent_off':
        return value.percent;
      case 'fixed_amount':
        return value.amount.toMinorUnits();
      case 'free_service':
        return 0;
    }
  },
} as const;
