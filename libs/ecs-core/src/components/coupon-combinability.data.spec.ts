import { describe, expect, it } from 'vitest';
import {
  CouponCombinability,
  CouponCombinabilityKind,
} from './coupon-combinability.data';

// The cases of `coupon-combinability.spec.ts`.

const exclusive = CouponCombinability.exclusive();
const stackable = CouponCombinability.stackable();

describe('CouponCombinability', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(CouponCombinabilityKind)).toEqual([
      'exclusive',
      'stackable',
    ]);
    expect(exclusive).toEqual({ kind: 'exclusive' });
    expect(stackable).toEqual({ kind: 'stackable' });
    expect(CouponCombinability.isExclusive(exclusive)).toBe(true);
    expect(CouponCombinability.isExclusive(stackable)).toBe(false);
  });

  it('lets anything join an empty selection', () => {
    expect(CouponCombinability.canAdd([], exclusive)).toBe(true);
    expect(CouponCombinability.canAdd([], stackable)).toBe(true);
  });

  it('keeps an exclusive candidate out of a non-empty selection', () => {
    expect(CouponCombinability.canAdd([stackable], exclusive)).toBe(false);
  });

  it('keeps a stackable candidate out of a selection holding an exclusive', () => {
    expect(CouponCombinability.canAdd([exclusive], stackable)).toBe(false);
  });

  it('lets stackables combine freely', () => {
    expect(CouponCombinability.canAdd([stackable, stackable], stackable)).toBe(
      true,
    );
  });

  it('rejects an exclusive coupled with anything else', () => {
    expect(CouponCombinability.isLegalSelection([exclusive, stackable])).toBe(
      false,
    );
    expect(CouponCombinability.isLegalSelection([stackable, exclusive])).toBe(
      false,
    );
  });

  it('accepts a lone exclusive, any number of stackables, or nothing', () => {
    expect(CouponCombinability.isLegalSelection([exclusive])).toBe(true);
    expect(CouponCombinability.isLegalSelection([stackable, stackable])).toBe(
      true,
    );
    expect(CouponCombinability.isLegalSelection([])).toBe(true);
  });
});
