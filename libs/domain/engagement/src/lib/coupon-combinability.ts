/**
 * How a coupon may combine with other discounts on a single order.
 * Discriminated union (not a `stackable: boolean`) so the stacking
 * vocabulary is extensible — ports v2's `CouponCombinability.ts` rules.
 *
 *   - `exclusive` — must be the ONLY discount on the order.
 *   - `stackable` — combines freely with other stackable coupons.
 */
export type CouponCombinability =
  CouponCombinabilityExclusive | CouponCombinabilityStackable;

export interface CouponCombinabilityExclusive {
  readonly kind: 'exclusive';
}

export interface CouponCombinabilityStackable {
  readonly kind: 'stackable';
}

const EXCLUSIVE: CouponCombinabilityExclusive = { kind: 'exclusive' };
const STACKABLE: CouponCombinabilityStackable = { kind: 'stackable' };

export const CouponCombinability = {
  exclusive(): CouponCombinabilityExclusive {
    return EXCLUSIVE;
  },
  stackable(): CouponCombinabilityStackable {
    return STACKABLE;
  },
  isExclusive(c: CouponCombinability): c is CouponCombinabilityExclusive {
    return c.kind === 'exclusive';
  },

  /** Can `candidate` join an already-chosen `current` set? */
  canAdd(
    current: readonly CouponCombinability[],
    candidate: CouponCombinability,
  ): boolean {
    if (current.length === 0) return true;
    if (candidate.kind === 'exclusive') return false;
    return !current.some(CouponCombinability.isExclusive);
  },

  /** Is a chosen set legal? An exclusive coupon must be the only one. */
  isLegalSelection(selection: readonly CouponCombinability[]): boolean {
    const hasExclusive = selection.some(CouponCombinability.isExclusive);
    return !hasExclusive || selection.length === 1;
  },
} as const;
