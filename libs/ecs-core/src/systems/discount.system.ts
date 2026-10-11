import {
  AppliedDiscount,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  type Money,
} from '@core/components';
import {
  EngagementError,
  Result,
  type Currency,
  type AppliedDiscountId,
  type CouponGrantId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import type { CouponGrant } from '@core/entities';
import { CouponGrantSystem } from './coupon-grant.system';

/**
 * One discount to apply — a selected grant, a validated code, or a discount
 * on the visit (`DiscountInput`, `discount-application.ts:14-23`), every
 * field present, its `CouponValue` slice flat beside them.
 * `grantedAtUtcMs` is the third key of the total order; `minSpendCents`
 * gates it on the subtotal, in the subtotal's currency (`null` = no gate) —
 * a discount whose gate fails is dropped silently.
 */
export type DiscountInput = {
  /** The visit's discount id, or the grant's when evaluating a client's grants. */
  readonly id: AppliedDiscountId | CouponGrantId;
  readonly label: string;
  readonly grantedAtUtcMs: UtcEpochMs;
  readonly minSpendCents: PriceCents | null;
} & CouponValue;

/** One applied discount line — always a positive amount, in the breakdown's currency. */
export type DiscountLine = {
  readonly id: AppliedDiscountId | CouponGrantId;
  readonly label: string;
  readonly amountCents: PriceCents;
};

/**
 * The bill, line by line: the subtotal, what each discount took off the
 * running remainder, their sum, and what is left (never below zero) — every
 * figure in the one `currency`.
 */
export type DiscountBreakdown = {
  readonly subtotalCents: PriceCents;
  readonly lines: readonly DiscountLine[];
  readonly discountTotalCents: PriceCents;
  readonly totalCents: PriceCents;
  readonly currency: Currency;
};

/** A grant the client holds, with the coupon's name the receipt prints. */
export type LabelledGrant = {
  readonly grant: CouponGrant;
  readonly label: string;
};

/**
 * A non-negative amount: the clamp keeps every figure a price, `+ 0` folds a
 * negative zero. Every figure here is a sum, a difference or a rounding of
 * safe integer cents, so the brand's smart constructor always accepts it.
 */
function cents(amount: number): PriceCents {
  const clamped = PriceCents.of(Math.max(0, amount) + 0);
  return clamped.ok ? clamped.value : PriceCents.ZERO;
}

function money(amountCents: number, currency: Currency): Money {
  return { amountCents: cents(amountCents), currency };
}

/** Method rank → magnitude → grantedAt → id: the §7.4 total order, never array position. */
function compareByTotalOrder(a: DiscountInput, b: DiscountInput): number {
  const rank = CouponValue.methodRank(a) - CouponValue.methodRank(b);
  if (rank !== 0) return rank;
  const magnitude = CouponValue.magnitude(a) - CouponValue.magnitude(b);
  if (magnitude !== 0) return magnitude;
  const granted = UtcEpochMs.compare(a.grantedAtUtcMs, b.grantedAtUtcMs);
  if (granted !== 0) return granted;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function meetsMinSpend(
  subtotal: Money,
  minSpendCents: PriceCents | null,
): boolean {
  return minSpendCents === null || subtotal.amountCents >= minSpendCents;
}

/** The positive discount one value takes off the running `remainder`. */
function amountOf(remainder: Money, value: CouponValue): Money {
  switch (value.discountMethod) {
    case DiscountMethod.PercentOff:
      return money(
        Math.round((remainder.amountCents * value.discountPercent) / 100),
        remainder.currency,
      );
    case DiscountMethod.FixedAmount:
      if (value.discountCurrency !== remainder.currency) {
        return money(0, remainder.currency);
      }
      return money(
        Math.min(remainder.amountCents, value.discountAmountCents),
        remainder.currency,
      );
    default:
      return remainder;
  }
}

/** `base − amount`, clamped at zero; a figure in another currency takes nothing off. */
function subtractClamped(base: Money, amount: Money): Money {
  if (base.currency !== amount.currency) return base;
  return money(base.amountCents - amount.amountCents, base.currency);
}

function sumLines(lines: readonly DiscountLine[]): PriceCents {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += (lines[i] as DiscountLine).amountCents;
  }
  return cents(total);
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
  const maxDiscount = Math.round((subtotal.amountCents * capPercent) / 100);
  const running = sumLines(lines);
  if (running <= maxDiscount) return lines;
  let excess = running - maxDiscount;
  const kept: DiscountLine[] = [...lines];
  for (let i = kept.length - 1; i >= 0 && excess > 0; i--) {
    const line = kept[i] as DiscountLine;
    const amount = line.amountCents;
    if (amount <= excess) {
      excess -= amount;
      kept.splice(i, 1);
    } else {
      kept[i] = { ...line, amountCents: cents(amount - excess) };
      excess = 0;
    }
  }
  return kept;
}

/**
 * The ONE discount evaluator (`discount-application.ts`), so the sheet, the
 * receipt and any report cannot disagree on a rounding. Fixed amounts come
 * off first, percentages bite the REDUCED remainder (15 % + 10 % is 23.5 %,
 * never 25 %), `FREE_SERVICE` zeroes what is left — in a total order of the
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
    const eligible: DiscountInput[] = [];
    for (let i = 0; i < discounts.length; i++) {
      const discount = discounts[i] as DiscountInput;
      if (meetsMinSpend(subtotal, discount.minSpendCents)) {
        eligible.push(discount);
      }
    }
    eligible.sort(compareByTotalOrder);

    let remainder = subtotal;
    const built: DiscountLine[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const discount = eligible[i] as DiscountInput;
      const amount = amountOf(remainder, discount);
      if (amount.amountCents === 0) continue;
      built.push({
        id: discount.id,
        label: discount.label,
        amountCents: amount.amountCents,
      });
      remainder = subtractClamped(remainder, amount);
    }

    const lines =
      capPercent === null ? built : applyCap(built, subtotal, capPercent);
    const discountTotal = sumLines(lines);
    return {
      subtotalCents: subtotal.amountCents,
      lines,
      discountTotalCents: discountTotal,
      totalCents: cents(subtotal.amountCents - discountTotal),
      currency: subtotal.currency,
    };
  },

  /** A discount ON THE VISIT, as the evaluator reads it — its value, stamped when applied. */
  inputOf(discount: AppliedDiscount): DiscountInput {
    return {
      id: discount.discountId,
      label: discount.label,
      grantedAtUtcMs: discount.appliedAtUtcMs,
      minSpendCents: null,
      ...CouponValue.of(discount),
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
   * grant no longer usable at `nowUtcMs` is left out (T2), each kept one
   * carries the coupon's name and the instant it was granted.
   */
  inputsFromGrants(
    grants: readonly LabelledGrant[],
    nowUtcMs: UtcEpochMs,
  ): readonly DiscountInput[] {
    const inputs: DiscountInput[] = [];
    for (let i = 0; i < grants.length; i++) {
      const { grant, label } = grants[i] as LabelledGrant;
      if (!CouponGrantSystem.isUsable(grant, nowUtcMs)) continue;
      inputs.push({
        id: grant.id,
        label,
        grantedAtUtcMs: grant.grantedAtUtcMs,
        minSpendCents: null,
        ...CouponValue.of(grant),
      });
    }
    return inputs;
  },

  /**
   * May these share one bill? An exclusive discount must be alone, and no
   * promise may be counted twice (`AppliedDiscount.isLegalSelection`).
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
      DiscountProvenance.sameProvenance(a, b) &&
      CouponValue.methodRank(a) === CouponValue.methodRank(b) &&
      CouponValue.magnitude(a) === CouponValue.magnitude(b)
    );
  },
} as const;
