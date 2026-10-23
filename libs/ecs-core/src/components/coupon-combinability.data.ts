/** The tags — the dictionary named after the field `combinability`. */
const COMBINABILITY = {
  /** Must be the ONLY discount on the order. */
  Exclusive: 'EXCLUSIVE',
  /** Combines freely with other stackable coupons. */
  Stackable: 'STACKABLE',
} as const;

/**
 * How a coupon may combine with other discounts on one order — a plain tag
 * field `combinability` (flatten-spec §3.2: today's union of two tag-only
 * objects carried no variant field, so it is the tag alone). A tag rather
 * than a `stackable: boolean`, so the stacking vocabulary can grow
 * (`coupon-combinability.ts:9`). The legacy stored values were the
 * lower-case `{ kind }` objects, which the legacy shims mapped.
 */
export type Combinability = (typeof COMBINABILITY)[keyof typeof COMBINABILITY];

function hasExclusive(set: readonly Combinability[]): boolean {
  for (let i = 0; i < set.length; i++) {
    if (set[i] === COMBINABILITY.Exclusive) return true;
  }
  return false;
}

export const Combinability = {
  ...COMBINABILITY,

  isExclusive(combinability: Combinability): boolean {
    return combinability === COMBINABILITY.Exclusive;
  },

  /** Can `candidate` join an already-chosen `current` set? */
  canAdd(current: readonly Combinability[], candidate: Combinability): boolean {
    if (current.length === 0) return true;
    if (candidate === COMBINABILITY.Exclusive) return false;
    return !hasExclusive(current);
  },

  /** Is a chosen set legal? An exclusive coupon must be the only one. */
  isLegalSelection(selection: readonly Combinability[]): boolean {
    return !hasExclusive(selection) || selection.length === 1;
  },
} as const;
