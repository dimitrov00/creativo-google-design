import type { AppliedDiscountId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { Combinability } from './coupon-combinability.data';
import type { CouponValue } from './coupon-value.data';
import type { DiscountProvenance } from './discount-provenance.data';

/**
 * A discount as it sits ON THE VISIT — a SNAPSHOT, exactly as a seat's terms
 * snapshot the catalogue (`applied-discount.ts:34-93`), and an element of the
 * 1-to-N `discounts[]` array, flat (Law 6): its own fields plus the
 * `DiscountProvenance` and `CouponValue` variant slices at the element's
 * root. A grant can be revoked or a code retired, and none of that may change
 * what a booked visit was promised: the value is copied at the moment of
 * applying, the grant (`discountGrantId`) or code (`discountCode`) kept as
 * provenance on its own variant and never re-resolved.
 * `BillingSystem.evaluate` sums them — this component computes no money.
 *
 * `combinability` is the coupon's own rule, copied so a later edit can check
 * the SET without re-resolving anything; a manual figure is stackable.
 */
export type AppliedDiscount = {
  /** Was `id` (N10) — `grant:<grantId>`, `code:<couponId>` or `manual`. */
  readonly discountId: AppliedDiscountId;
  /** What the receipt calls it — the coupon's name, or the counter's word. */
  readonly label: string;
  /** When it was put on the visit — the evaluator's tie-break, and provenance. */
  readonly appliedAtUtcMs: UtcEpochMs;
  readonly combinability: Combinability;
} & DiscountProvenance &
  CouponValue;

export const AppliedDiscount = {
  /** Must this discount be alone on the bill? */
  isExclusive(discount: AppliedDiscount): boolean {
    return Combinability.isExclusive(discount.combinability);
  },

  /**
   * May these share one bill? An exclusive discount must be alone, and no
   * promise may be counted twice — the same discount id twice is a caller
   * bug, not a double discount.
   */
  isLegalSelection(discounts: readonly AppliedDiscount[]): boolean {
    let exclusive = false;
    for (let i = 0; i < discounts.length; i++) {
      const discount = discounts[i] as AppliedDiscount;
      if (AppliedDiscount.isExclusive(discount)) exclusive = true;
      for (let k = 0; k < i; k++) {
        if (
          (discounts[k] as AppliedDiscount).discountId === discount.discountId
        )
          return false;
      }
    }
    return !exclusive || discounts.length === 1;
  },
} as const;
