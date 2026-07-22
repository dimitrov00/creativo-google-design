import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
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

/**
 * Ports v2's `coupon/apply-discounts.ts`, fixing legacy bug 7.4:
 * "which coupon gives way under the cap depends on sort stability; ties
 * break on array index." That made the outcome depend on the caller's
 * incidental array order, not a property of the discounts themselves.
 *
 * Fix: a **total deterministic order** — kind rank (fixed → percent →
 * free_service) → magnitude → `grantedAt` → `id` — so two callers passing
 * the same discount set in different array orders always get the same
 * breakdown. Every tiebreak key is a property of the discount itself,
 * never the position it happened to occupy in the input array.
 */
export const DiscountApplication = {
  /** Validates a cap percentage — the one door a raw number enters this module through. */
  capPercent(raw: number): Result<number, DiscountCapOutOfRangeError> {
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return fail(new DiscountCapOutOfRangeError(raw));
    }
    return ok(raw);
  },

  apply(
    subtotal: Money,
    discounts: readonly DiscountInput[],
    options: ApplyDiscountsOptions = {},
  ): DiscountBreakdown {
    const currency = subtotal.currencyCode();
    const eligible = discounts.filter((d) =>
      meetsMinSpend(subtotal, d.minSpend),
    );
    const ordered = [...eligible].sort(compareByTotalOrder);

    let remainder = subtotal;
    const built: DiscountLine[] = [];
    for (const discount of ordered) {
      const amount = discountAmount(remainder, discount.value);
      if (amount.toMinorUnits() === 0) continue;
      built.push({ id: discount.id, label: discount.label, amount });
      remainder = subtractClamped(remainder, amount);
    }

    const lines =
      options.capPercent !== undefined
        ? applyCap(built, subtotal, options.capPercent)
        : built;
    const discountTotal = sumLines(lines, currency);
    const total = subtractClamped(subtotal, discountTotal);

    return { subtotal, lines, discountTotal, total };
  },
};

/** Kind rank → magnitude → grantedAt → id: the full §7.4 total order, none of it array position. */
function compareByTotalOrder(a: DiscountInput, b: DiscountInput): number {
  const rankDiff =
    CouponValue.kindRank(a.value) - CouponValue.kindRank(b.value);
  if (rankDiff !== 0) return rankDiff;

  const magDiff =
    CouponValue.magnitude(a.value) - CouponValue.magnitude(b.value);
  if (magDiff !== 0) return magDiff;

  if (a.grantedAt.isBefore(b.grantedAt)) return -1;
  if (a.grantedAt.isAfter(b.grantedAt)) return 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function meetsMinSpend(subtotal: Money, minSpend: Money | undefined): boolean {
  if (!minSpend) return true;
  if (minSpend.currencyCode() !== subtotal.currencyCode()) return false;
  return subtotal.toMinorUnits() >= minSpend.toMinorUnits();
}

/** The positive discount one value takes off the running `remainder`. */
function discountAmount(remainder: Money, value: CouponValue): Money {
  switch (value.kind) {
    case 'percent_off': {
      const amount = Math.round(
        (remainder.toMinorUnits() * value.percent) / 100,
      );
      return moneyOrZero(amount, remainder.currencyCode());
    }
    case 'fixed_amount': {
      if (value.amount.currencyCode() !== remainder.currencyCode()) {
        return moneyOrZero(0, remainder.currencyCode());
      }
      const amount = Math.min(
        remainder.toMinorUnits(),
        value.amount.toMinorUnits(),
      );
      return moneyOrZero(amount, remainder.currencyCode());
    }
    case 'free_service':
      return remainder;
  }
}

/** Subtract, clamped at zero — never produces negative money regardless of input order. */
function subtractClamped(base: Money, amount: Money): Money {
  if (base.currencyCode() !== amount.currencyCode()) return base;
  const diff = Math.max(0, base.toMinorUnits() - amount.toMinorUnits());
  return moneyOrZero(diff, base.currencyCode());
}

function moneyOrZero(minorUnits: number, currencyCode: string): Money {
  const result = Money.fromMinorUnitsAndCode(
    Math.max(0, minorUnits),
    currencyCode,
  );
  if (result.isSuccess()) return result.value;
  // Unreachable in practice (currencyCode is always sourced from an already-valid Money), but
  // fail closed to zero rather than propagate a currency lookup failure into arithmetic.
  const zero = Money.fromMinorUnitsAndCode(0, currencyCode);
  return zero.isSuccess() ? zero.value : (undefined as never);
}

function sumLines(lines: readonly DiscountLine[], currencyCode: string): Money {
  return lines.reduce<Money>(
    (acc, line) =>
      line.amount.currencyCode() === currencyCode ? add(acc, line.amount) : acc,
    moneyOrZero(0, currencyCode),
  );
}

function add(a: Money, b: Money): Money {
  const result = a.add(b);
  return result.isSuccess() ? result.value : a;
}

/**
 * Trim a discount cap. Reduces the *trailing* lines first (per the now-fully-
 * deterministic order above, "trailing" is itself deterministic) until the
 * total no longer exceeds `capPercent`% of the subtotal.
 */
function applyCap(
  lines: readonly DiscountLine[],
  subtotal: Money,
  capPercent: number,
): readonly DiscountLine[] {
  const currency = subtotal.currencyCode();
  const maxDiscountMinor = Math.round(
    (subtotal.toMinorUnits() * capPercent) / 100,
  );
  const runningTotal = sumLines(lines, currency);
  if (runningTotal.toMinorUnits() <= maxDiscountMinor) return lines;

  let excess = runningTotal.toMinorUnits() - maxDiscountMinor;
  const result = [...lines];
  for (let i = result.length - 1; i >= 0 && excess > 0; i--) {
    const line = result[i] as DiscountLine;
    const lineMinor = line.amount.toMinorUnits();
    if (lineMinor <= excess) {
      excess -= lineMinor;
      result.splice(i, 1);
    } else {
      result[i] = {
        ...line,
        amount: moneyOrZero(lineMinor - excess, currency),
      };
      excess = 0;
    }
  }
  return result;
}
