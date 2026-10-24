import { CouponGrantId, Currency, PriceCents, defect } from '@core/primitives';
import {
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  VoucherCode,
} from '@core/components';
import type { DiscountPromise } from '@core/systems';
import type {
  VisitEditorDiscount,
  VisitEditorDiscountValue,
} from './staff-visit-editor';

/*
 * THE SHEET'S DISCOUNT EDGE (pass C, E-23): where the visit sheet's plain
 * draft vocabulary for a discount (`VisitEditorDiscount`,
 * `VisitEditorDiscountValue`) and the domain's (`CouponValue`,
 * `DiscountProvenance`, `Combinability`) meet, both ways. Parsing only — what
 * a line takes off, whether it may join and what the set becomes are
 * `BillingSystem`'s, `Combinability`'s and `DiscountSystem`'s. The VM's own
 * reshape onto the stored slices is pass D's (D-11).
 */

/**
 * The shop's one currency (see `project_currency_is_eur`) — the code the
 * sheet drafts its money in and parses a drafted discount's value in
 * (`promiseOf`, `toCouponValue`). One home: the visit sheet and the
 * dashboard's save comparison read it from here.
 */
export const MONEY_CODE: Currency = Currency.EUR;

/**
 * The stored value (a coupon's, a grant's, an applied discount's — any
 * slice carrying `discountMethod`) → the sheet's plain one. The one place
 * the two meet.
 */
export function discountValueOf(value: CouponValue): VisitEditorDiscountValue {
  switch (value.discountMethod) {
    case DiscountMethod.PercentOff:
      return {
        discountMethod: DiscountMethod.PercentOff,
        percent: value.discountPercent,
      };
    case DiscountMethod.FixedAmount:
      return {
        discountMethod: DiscountMethod.FixedAmount,
        amountCents: value.discountAmountCents,
      };
    case DiscountMethod.FreeService:
      return { discountMethod: DiscountMethod.FreeService };
  }
}

/** The sheet's plain value → the domain's, through its validating doors, or `null`. */
export function toCouponValue(
  value: VisitEditorDiscountValue,
  currency: Currency,
): CouponValue | null {
  switch (value.discountMethod) {
    case DiscountMethod.PercentOff: {
      const result = CouponValue.percentOff(value.percent);
      return result.ok ? result.value : null;
    }
    case DiscountMethod.FixedAmount: {
      const cents = PriceCents.of(value.amountCents);
      if (!cents.ok) return null;
      const result = CouponValue.fixedAmount(cents.value, currency);
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
 * Where a drafted line came from, as the stored provenance: the grant it
 * honours, the code it was opened with, or nothing for a manual figure.
 * The grant id and the code are the owner's — a grant document's id, a
 * published coupon's code or the code the owner answered for — so they are
 * ids by construction here, compared exactly as they were handed in.
 */
function provenanceOf(discount: VisitEditorDiscount): DiscountProvenance {
  switch (discount.discountSource) {
    case DiscountSource.Grant:
      return DiscountProvenance.grant(CouponGrantId.of(discount.grantId ?? ''));
    case DiscountSource.Code:
      return DiscountProvenance.code(VoucherCode.of(discount.code ?? ''));
    case DiscountSource.Manual:
      return DiscountProvenance.manual();
  }
}

/**
 * WHAT A DRAFTED LINE PROMISES, as the domain's set rules read it
 * (`DiscountSystem.samePromise`, `DiscountSystem.withAdded`) — the ONE edge
 * parse of a line's identity, beside {@link toCouponValue}: its
 * combinability, its provenance and its value. A line's value is always a
 * coupon's (it was read off one with {@link discountValueOf}, or typed
 * through `CouponValue`'s guards), so one that does not parse back is a
 * broken invariant, never input.
 */
export function promiseOf(
  discount: VisitEditorDiscount,
  currency: Currency,
): DiscountPromise {
  const value =
    toCouponValue(discount.value, currency) ??
    defect(`a drafted discount whose value is no coupon's: ${discount.label}`);
  return {
    combinability: combinabilityOf(discount.exclusive),
    ...provenanceOf(discount),
    ...value,
  };
}
