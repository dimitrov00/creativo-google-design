import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  type CouponValue as CouponValueData,
  type DiscountBreakdown as DiscountBreakdownData,
  type DiscountInput as DiscountInputData,
  DiscountSystem,
  type Money as MoneyData,
} from '@creativo/ecs-core';
import { CouponValue } from './coupon-value';
import { DiscountCapOutOfRangeError } from './discount-application.errors';

/**
 * One discount to apply, projected from a selected coupon grant or a
 * validated promo code. `minSpend` (optional) gates it on the order
 * subtotal — a discount whose gate fails is silently dropped.
 */
export interface DiscountInput {
  readonly id: string;
  readonly label: string;
  readonly value: CouponValue;
  /** When this discount was granted — the third key in the §7.4 total order. */
  readonly grantedAt: ZonedDateTime;
  readonly minSpend?: Money;
}

/** One applied discount line in the breakdown (a positive amount). */
export interface DiscountLine {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
}

export interface DiscountBreakdown {
  readonly subtotal: Money;
  readonly lines: readonly DiscountLine[];
  readonly discountTotal: Money;
  readonly total: Money;
}

export interface ApplyDiscountsOptions {
  /** Max total discount as a share of the subtotal, 0-100 (anti-abuse cap). */
  readonly capPercent?: number;
}

/*
 * THIN SHIM (ECS migration Phase 2). The one evaluator is
 * `DiscountSystem.apply` — the deterministic total order (kind rank →
 * magnitude → grantedAt → id, never array position: legacy bug 7.4), fixed
 * amounts before percentages on the running remainder, `free_service` last,
 * the anti-abuse cap trimming the trailing lines, never below zero. This
 * module keeps the legacy shapes its callers hold and only converts.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toMoneyData(money: Money): MoneyData {
  return {
    amountMinorUnits: money.toMinorUnits(),
    currencyCode: money.currencyCode(),
  };
}

function fromMoneyData(money: MoneyData): Money {
  const result = Money.fromMinorUnitsAndCode(
    money.amountMinorUnits,
    money.currencyCode,
  );
  // Unreachable: every figure is drawn from the subtotal's own valid code.
  if (result.isFailure()) throw new Error('unreachable: discount currency');
  return result.value;
}

function toValueData(value: CouponValue): CouponValueData {
  return value.kind === 'fixed_amount'
    ? { kind: 'fixed_amount', amount: toMoneyData(value.amount) }
    : value;
}

function toInputData(input: DiscountInput): DiscountInputData {
  return {
    id: input.id,
    label: input.label,
    value: toValueData(input.value),
    grantedAtMs: input.grantedAt.toMillis(),
    minSpend: input.minSpend === undefined ? null : toMoneyData(input.minSpend),
  };
}

function fromBreakdownData(
  breakdown: DiscountBreakdownData,
): DiscountBreakdown {
  return {
    subtotal: fromMoneyData(breakdown.subtotal),
    lines: breakdown.lines.map((line) => ({
      id: line.id,
      label: line.label,
      amount: fromMoneyData(line.amount),
    })),
    discountTotal: fromMoneyData(breakdown.discountTotal),
    total: fromMoneyData(breakdown.total),
  };
}

/**
 * The one discount evaluator — `DiscountSystem` behind the legacy shapes:
 * two callers passing the same discount set in different array orders
 * always get the same breakdown.
 */
export const DiscountApplication = {
  /** Validates a cap percentage — the one door a raw number enters this module through. */
  capPercent(raw: number): Result<number, DiscountCapOutOfRangeError> {
    const cap = DiscountSystem.capPercent(raw);
    return cap.ok ? ok(cap.value) : fail(new DiscountCapOutOfRangeError(raw));
  },

  apply(
    subtotal: Money,
    discounts: readonly DiscountInput[],
    options: ApplyDiscountsOptions = {},
  ): DiscountBreakdown {
    return fromBreakdownData(
      DiscountSystem.apply(
        toMoneyData(subtotal),
        discounts.map(toInputData),
        options.capPercent ?? null,
      ),
    );
  },
};
