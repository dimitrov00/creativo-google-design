import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  AppliedDiscountId,
  type CouponValue as CouponValueData,
  Currency,
  type DiscountBreakdown as DiscountBreakdownData,
  type DiscountInput as DiscountInputData,
  DiscountMethod,
  DiscountSystem,
  type Money as MoneyData,
  PriceCents,
  UtcEpochMs,
  defect,
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

/** The legacy lower-case value tag → the ecs-core `DiscountMethod` (flatten-spec §8.9). */
const LEGACY_DISCOUNT_METHOD = {
  percent_off: DiscountMethod.PercentOff,
  fixed_amount: DiscountMethod.FixedAmount,
  free_service: DiscountMethod.FreeService,
} as const satisfies Record<CouponValue['kind'], DiscountMethod>;

function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `Money` / `ZonedDateTime` already holds the rule.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function centsOf(money: Money): PriceCents {
  return sure(PriceCents.of(money.toMinorUnits()), 'an amount');
}

function currencyOf(money: Money): Currency {
  return sure(Currency.parse(money.currencyCode()), 'a currency');
}

function toMoneyData(money: Money): MoneyData {
  return { amountCents: centsOf(money), currency: currencyOf(money) };
}

function fromCents(amountCents: PriceCents, currency: Currency): Money {
  const result = Money.fromMinorUnitsAndCode(amountCents, currency);
  // Unreachable: every figure is drawn from the subtotal's own valid code.
  if (result.isFailure()) defect('unreachable: discount currency');
  return result.value;
}

/** The legacy value as the flat slice — converted as it stands, never re-validated. */
function toValueData(value: CouponValue): CouponValueData {
  switch (value.kind) {
    case 'percent_off':
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.percent_off,
        discountPercent: value.percent,
      };
    case 'fixed_amount':
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.fixed_amount,
        discountAmountCents: centsOf(value.amount),
        discountCurrency: currencyOf(value.amount),
      };
    case 'free_service':
      return { discountMethod: LEGACY_DISCOUNT_METHOD.free_service };
  }
}

/**
 * The input as the evaluator reads it. A minimum spend is a figure in the
 * SUBTOTAL's currency now (`minSpendCents`): a gate in another currency can
 * never be met, so the input it gates is dropped here — as the evaluator
 * always dropped it.
 */
function toInputData(
  input: DiscountInput,
  subtotalCurrency: Currency,
): DiscountInputData | null {
  const minSpend = input.minSpend;
  if (minSpend !== undefined && currencyOf(minSpend) !== subtotalCurrency) {
    return null;
  }
  return {
    id: AppliedDiscountId.of(input.id),
    label: input.label,
    grantedAtUtcMs: sure(
      UtcEpochMs.of(input.grantedAt.toMillis()),
      'an instant',
    ),
    minSpendCents: minSpend === undefined ? null : centsOf(minSpend),
    ...toValueData(input.value),
  };
}

function fromBreakdownData(
  breakdown: DiscountBreakdownData,
): DiscountBreakdown {
  return {
    subtotal: fromCents(breakdown.subtotalCents, breakdown.currency),
    lines: breakdown.lines.map((line) => ({
      id: line.id,
      label: line.label,
      amount: fromCents(line.amountCents, breakdown.currency),
    })),
    discountTotal: fromCents(breakdown.discountTotalCents, breakdown.currency),
    total: fromCents(breakdown.totalCents, breakdown.currency),
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
    const subtotalData = toMoneyData(subtotal);
    const inputs: DiscountInputData[] = [];
    for (const discount of discounts) {
      const input = toInputData(discount, subtotalData.currency);
      if (input !== null) inputs.push(input);
    }
    return fromBreakdownData(
      DiscountSystem.apply(subtotalData, inputs, options.capPercent ?? null),
    );
  },
};
