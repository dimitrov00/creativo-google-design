/** How a coupon may combine with other discounts, by kind — the stored tags, unchanged. */
export const CouponCombinabilityKind = {
  /** Must be the ONLY discount on the order. */
  Exclusive: 'exclusive',
  /** Combines freely with other stackable coupons. */
  Stackable: 'stackable',
} as const;
export type CouponCombinabilityKind =
  (typeof CouponCombinabilityKind)[keyof typeof CouponCombinabilityKind];

/**
 * How a coupon may combine with other discounts on one order — a union, not
 * a `stackable: boolean`, so the stacking vocabulary can grow
 * (`coupon-combinability.ts:9`).
 */
export type CouponCombinability =
  CouponCombinability.Exclusive | CouponCombinability.Stackable;

export const CouponCombinability = {
  exclusive(): CouponCombinability.Exclusive {
    return { kind: CouponCombinabilityKind.Exclusive };
  },

  stackable(): CouponCombinability.Stackable {
    return { kind: CouponCombinabilityKind.Stackable };
  },

  isExclusive(c: CouponCombinability): c is CouponCombinability.Exclusive {
    return c.kind === CouponCombinabilityKind.Exclusive;
  },

  /** Can `candidate` join an already-chosen `current` set? */
  canAdd(
    current: readonly CouponCombinability[],
    candidate: CouponCombinability,
  ): boolean {
    if (current.length === 0) return true;
    if (candidate.kind === CouponCombinabilityKind.Exclusive) return false;
    return !hasExclusive(current);
  },

  /** Is a chosen set legal? An exclusive coupon must be the only one. */
  isLegalSelection(selection: readonly CouponCombinability[]): boolean {
    return !hasExclusive(selection) || selection.length === 1;
  },
} as const;

function hasExclusive(set: readonly CouponCombinability[]): boolean {
  for (let i = 0; i < set.length; i++) {
    if (
      (set[i] as CouponCombinability).kind === CouponCombinabilityKind.Exclusive
    ) {
      return true;
    }
  }
  return false;
}

export namespace CouponCombinability {
  export type Exclusive = {
    readonly kind: typeof CouponCombinabilityKind.Exclusive;
  };
  export type Stackable = {
    readonly kind: typeof CouponCombinabilityKind.Stackable;
  };
}
