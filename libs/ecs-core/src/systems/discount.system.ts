import { AppliedDiscount } from '../components/applied-discount.data';
import { CouponValue, CouponValueKind } from '../components/coupon-value.data';
import { EngagementError } from '../components/engagement-errors.data';
import type { Money } from '../components/money.data';
import { Result } from '../components/result.data';
import type { CouponGrantEntity } from '../entities/coupon-grant.entity';
import { CouponGrantSystem } from './coupon-grant.system';

/**
 * One discount to apply — a selected grant, a validated code, or a figure on
 * the visit (`DiscountInput`, `discount-application.ts:14-23`), every field
 * present. `grantedAtMs` is the third key of the total order; `minSpend`
 * gates it on the subtotal (`null` = no gate) — a discount whose gate fails
 * is dropped silently.
 */
export type DiscountInput = {
  readonly id: string;
  readonly label: string;
  readonly value: CouponValue;
  readonly grantedAtMs: number;
  readonly minSpend: Money | null;
};

/** One applied discount line — always a positive amount. */
export type DiscountLine = {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
};

/**
 * The bill, line by line: the subtotal, what each discount took off the
 * running remainder, their sum, and what is left (never below zero).
 */
export type DiscountBreakdown = {
  readonly subtotal: Money;
  readonly lines: readonly DiscountLine[];
  readonly discountTotal: Money;
  readonly total: Money;
};

/** A grant the client holds, with the coupon's name the receipt prints. */
export type LabelledGrant = {
  readonly grant: CouponGrantEntity;
  readonly label: string;
};

function money(amountMinorUnits: number, currencyCode: string): Money {
  // `+ 0` folds a negative zero; the clamp keeps every figure a price.
  return { amountMinorUnits: Math.max(0, amountMinorUnits) + 0, currencyCode };
}

/** Kind rank → magnitude → grantedAt → id: the §7.4 total order, never array position. */
function compareByTotalOrder(a: DiscountInput, b: DiscountInput): number {
  const rank = CouponValue.kindRank(a.value) - CouponValue.kindRank(b.value);
  if (rank !== 0) return rank;
  const magnitude =
    CouponValue.magnitude(a.value) - CouponValue.magnitude(b.value);
  if (magnitude !== 0) return magnitude;
  if (a.grantedAtMs < b.grantedAtMs) return -1;
  if (a.grantedAtMs > b.grantedAtMs) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function meetsMinSpend(subtotal: Money, minSpend: Money | null): boolean {
  if (minSpend === null) return true;
  if (minSpend.currencyCode !== subtotal.currencyCode) return false;
  return subtotal.amountMinorUnits >= minSpend.amountMinorUnits;
}

/** The positive discount one value takes off the running `remainder`. */
function amountOf(remainder: Money, value: CouponValue): Money {
  switch (value.kind) {
    case CouponValueKind.PercentOff:
      return money(
        Math.round((remainder.amountMinorUnits * value.percent) / 100),
        remainder.currencyCode,
      );
    case CouponValueKind.FixedAmount:
      if (value.amount.currencyCode !== remainder.currencyCode) {
        return money(0, remainder.currencyCode);
      }
      return money(
        Math.min(remainder.amountMinorUnits, value.amount.amountMinorUnits),
        remainder.currencyCode,
      );
    default:
      return remainder;
  }
}

/** `base − amount`, clamped at zero; a figure in another currency takes nothing off. */
function subtractClamped(base: Money, amount: Money): Money {
  if (base.currencyCode !== amount.currencyCode) return base;
  return money(
    base.amountMinorUnits - amount.amountMinorUnits,
    base.currencyCode,
  );
}

function sumLines(lines: readonly DiscountLine[], currencyCode: string): Money {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const amount = (lines[i] as DiscountLine).amount;
    if (amount.currencyCode === currencyCode) total += amount.amountMinorUnits;
  }
  return money(total, currencyCode);
}

/**
 * The anti-abuse cap: trims the TRAILING lines first (in the total order,
 * so "trailing" is deterministic) until the discount no longer exceeds
 * `capPercent` % of the subtotal.
 */
function applyCap(
  lines: readonly DiscountLine[],
  subtotal: Money,
  capPercent: number,
): readonly DiscountLine[] {
  const currency = subtotal.currencyCode;
  const maxDiscount = Math.round(
    (subtotal.amountMinorUnits * capPercent) / 100,
  );
  const running = sumLines(lines, currency).amountMinorUnits;
  if (running <= maxDiscount) return lines;
  let excess = running - maxDiscount;
  const kept: DiscountLine[] = [...lines];
  for (let i = kept.length - 1; i >= 0 && excess > 0; i--) {
    const line = kept[i] as DiscountLine;
    const amount = line.amount.amountMinorUnits;
    if (amount <= excess) {
      excess -= amount;
      kept.splice(i, 1);
    } else {
      kept[i] = { ...line, amount: money(amount - excess, currency) };
      excess = 0;
    }
  }
  return kept;
}

/**
 * The ONE discount evaluator (`discount-application.ts`), so the sheet, the
 * receipt and any report cannot disagree on a rounding. Fixed amounts come
 * off first, percentages bite the REDUCED remainder (15 % + 10 % is 23.5 %,
 * never 25 %), `free_service` zeroes what is left — in a total order of the
 * discounts' own properties, so the same set in any array order gives the
 * same breakdown (legacy bug 7.4). Money never goes below zero.
 */
export const DiscountSystem = {
  /** The edge guard for a cap: a finite percentage, 0–100. */
  capPercent(raw: number): Result<number, EngagementError.DiscountCapInvalid> {
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return Result.err(EngagementError.discountCapInvalid(raw));
    }
    return Result.ok(raw);
  },

  /** What one value takes off `amount` — positive, never more than `amount`. */
  amountOf,

  /**
   * The breakdown of `discounts` against `subtotal`, under the anti-abuse
   * cap when one is given (`null` = uncapped).
   */
  apply(
    subtotal: Money,
    discounts: readonly DiscountInput[],
    capPercent: number | null,
  ): DiscountBreakdown {
    const currency = subtotal.currencyCode;
    const eligible: DiscountInput[] = [];
    for (let i = 0; i < discounts.length; i++) {
      const discount = discounts[i] as DiscountInput;
      if (meetsMinSpend(subtotal, discount.minSpend)) eligible.push(discount);
    }
    eligible.sort(compareByTotalOrder);

    let remainder = subtotal;
    const built: DiscountLine[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const discount = eligible[i] as DiscountInput;
      const amount = amountOf(remainder, discount.value);
      if (amount.amountMinorUnits === 0) continue;
      built.push({ id: discount.id, label: discount.label, amount });
      remainder = subtractClamped(remainder, amount);
    }

    const lines =
      capPercent === null ? built : applyCap(built, subtotal, capPercent);
    const discountTotal = sumLines(lines, currency);
    return {
      subtotal,
      lines,
      discountTotal,
      total: subtractClamped(subtotal, discountTotal),
    };
  },

  /** A discount ON THE VISIT, as the evaluator reads it — its value, stamped when applied. */
  inputOf(discount: AppliedDiscount): DiscountInput {
    return {
      id: discount.id,
      label: discount.label,
      value: discount.value,
      grantedAtMs: discount.appliedAtMs,
      minSpend: null,
    };
  },

  /** {@link inputOf} for every discount on the visit, in order. */
  inputsOf(discounts: readonly AppliedDiscount[]): readonly DiscountInput[] {
    const inputs: DiscountInput[] = [];
    for (let i = 0; i < discounts.length; i++) {
      inputs.push(DiscountSystem.inputOf(discounts[i] as AppliedDiscount));
    }
    return inputs;
  },

  /**
   * The client's usable grants as discounts (`ApplyDiscountsUseCase`): a
   * grant no longer usable at `nowMs` is left out, each kept one carries the
   * coupon's name and the instant it was granted.
   */
  inputsFromGrants(
    grants: readonly LabelledGrant[],
    nowMs: number,
  ): readonly DiscountInput[] {
    const inputs: DiscountInput[] = [];
    for (let i = 0; i < grants.length; i++) {
      const { grant, label } = grants[i] as LabelledGrant;
      if (!CouponGrantSystem.isUsable(grant, nowMs)) continue;
      inputs.push({
        id: grant.id,
        label,
        value: grant.value,
        grantedAtMs: grant.grantedAtMs,
        minSpend: null,
      });
    }
    return inputs;
  },

  /**
   * May these share one bill? An exclusive discount must be alone, and no
   * promise may be counted twice (`AppliedDiscount.isLegalSet`).
   */
  isLegalSet(discounts: readonly AppliedDiscount[]): boolean {
    return AppliedDiscount.isLegalSelection(discounts);
  },

  /**
   * The same PROMISE: source, provenance and value agree — the instant it
   * was applied is not identity (`AppliedDiscount.equals`).
   */
  samePromise(a: AppliedDiscount, b: AppliedDiscount): boolean {
    return (
      a.source === b.source &&
      a.grantId === b.grantId &&
      a.code === b.code &&
      CouponValue.kindRank(a.value) === CouponValue.kindRank(b.value) &&
      CouponValue.magnitude(a.value) === CouponValue.magnitude(b.value)
    );
  },
} as const;
