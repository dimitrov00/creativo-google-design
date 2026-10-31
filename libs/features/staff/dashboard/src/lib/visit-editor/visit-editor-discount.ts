import { type Currency, defect } from '@core/primitives';
import {
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
} from '@core/components';
import type { DiscountPromise } from '@core/systems';
import type { VisitEditorDiscount } from './staff-visit-editor';

/*
 * THE SHEET'S DISCOUNT EDGE (pass C, E-23; reshaped in pass D): where the
 * visit sheet's drafted discount (`VisitEditorDiscount` — the domain's own
 * `DiscountProvenance & CouponValue`, flat, beside the sheet's label, grant,
 * code and rule) is read by the domain's set rules. Parsing only — what a
 * line takes off, whether it may join and what the set becomes are
 * `BillingSystem`'s, `Combinability`'s and `DiscountSystem`'s. Every value
 * is read in the BILL's currency (`VisitEditorVm.currency`, pass D DEP-21 —
 * the constant EUR it replaced is gone with its last reader).
 */

/**
 * A drafted line's value re-validated INTO THE BILL: read back through the
 * domain's validating doors, a fixed amount re-stated in `currency` (the
 * bill's) — or `null` for one the guards refuse (a percent off 0–100, a sum
 * that is no positive amount). Its input already is a `CouponValue`; what
 * this adds is the bill's currency and the guards. The drafted discount
 * passes straight in.
 */
export function couponValueInBill(
  value: CouponValue,
  currency: Currency,
): CouponValue | null {
  switch (value.discountMethod) {
    case DiscountMethod.PercentOff: {
      const result = CouponValue.percentOff(value.discountPercent);
      return result.ok ? result.value : null;
    }
    case DiscountMethod.FixedAmount: {
      const result = CouponValue.fixedAmount(
        value.discountAmountCents,
        currency,
      );
      return result.ok ? result.value : null;
    }
    case DiscountMethod.FreeService:
      return CouponValue.freeService();
  }
}

/** A line's `exclusive` flag as the domain's tag: alone on the bill, or one that stacks. */
export function combinabilityOf(exclusive: boolean): Combinability {
  return exclusive ? Combinability.Exclusive : Combinability.Stackable;
}

/**
 * Where a drafted line came from, as the stored provenance — exactly its
 * variant's evidence: the grant it honours, the code it was opened with, or
 * nothing for a manual figure. The line carries it already (it IS a
 * `DiscountProvenance`); this copies only those fields.
 */
function provenanceOf(discount: VisitEditorDiscount): DiscountProvenance {
  switch (discount.discountSource) {
    case DiscountSource.Grant:
      return DiscountProvenance.grant(discount.discountGrantId);
    case DiscountSource.Code:
      return DiscountProvenance.code(discount.discountCode);
    case DiscountSource.Manual:
      return DiscountProvenance.manual();
  }
}

/**
 * WHAT A DRAFTED LINE PROMISES, as the domain's set rules read it
 * (`DiscountSystem.samePromise`, `DiscountSystem.withAdded`) — the ONE edge
 * read of a line's identity, beside {@link couponValueInBill}: its
 * combinability, its provenance and its value. A line's value is always a
 * coupon's (read off one, or typed through `CouponValue`'s guards), so one
 * that does not read back is a broken invariant, never input.
 */
export function promiseOf(
  discount: VisitEditorDiscount,
  currency: Currency,
): DiscountPromise {
  const value =
    couponValueInBill(discount, currency) ??
    defect(`a drafted discount whose value is no coupon's: ${discount.label}`);
  return {
    combinability: combinabilityOf(discount.exclusive),
    ...provenanceOf(discount),
    ...value,
  };
}
