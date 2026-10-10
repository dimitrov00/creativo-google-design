import type { CouponGrantId } from '../entities/coupon-grant.entity';
import {
  type CouponCombinability,
  CouponCombinabilityKind,
} from './coupon-combinability.data';
import type { CouponValue } from './coupon-value.data';

/**
 * Where a discount on a visit came from — the ONLY source of these strings.
 * The stored values are today's (`appointment-document.ts:331-335`); this tag
 * set is distinct from `CouponValueKind` (WHAT is taken off).
 */
export const AppliedDiscountSource = {
  /** A coupon the CLIENT already held — the shop keeping a promise. */
  Grant: 'grant',
  /** A shareable code the shop published, presented at the counter. */
  Code: 'code',
  /** A number a human invented at the counter, role-gated. */
  Manual: 'manual',
} as const;
export type AppliedDiscountSource =
  (typeof AppliedDiscountSource)[keyof typeof AppliedDiscountSource];

/**
 * A discount as it sits ON THE VISIT — a SNAPSHOT, exactly as a seat's terms
 * snapshot the catalogue (`applied-discount.ts:34-93`). A grant can be
 * revoked or a code retired, and none of that may change what a booked visit
 * was promised: the value is copied at the moment of applying, `grantId` and
 * `code` kept as provenance and never re-resolved. Stored at the appointment
 * root as `discounts[]`; `BillingSystem.evaluate` sums them — this component
 * computes no money.
 *
 * `combinability` is the coupon's own rule, copied so a later edit can check
 * the SET without re-resolving anything; a manual figure is stackable.
 */
export type AppliedDiscount = {
  readonly id: string;
  readonly source: AppliedDiscountSource;
  readonly value: CouponValue;
  /** What the receipt calls it — the coupon's name, or the counter's word. */
  readonly label: string;
  /** The grant honoured, for `grant`; `null` otherwise. */
  readonly grantId: CouponGrantId | null;
  /** The code presented, for `code`; `null` otherwise. */
  readonly code: string | null;
  /** When it was put on the visit — the evaluator's tie-break, and provenance. */
  readonly appliedAtMs: number;
  readonly combinability: CouponCombinability;
};

export const AppliedDiscount = {
  /** Must this discount be alone on the bill? */
  isExclusive(discount: AppliedDiscount): boolean {
    return discount.combinability.kind === CouponCombinabilityKind.Exclusive;
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
        if ((discounts[k] as AppliedDiscount).id === discount.id) return false;
      }
    }
    return !exclusive || discounts.length === 1;
  },
} as const;
