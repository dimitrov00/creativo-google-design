import { describe, expect, it } from 'vitest';
import {
  AppliedDiscount,
  AppliedDiscountSource,
} from './applied-discount.data';
import { CouponCombinability } from './coupon-combinability.data';
import { CouponValue } from './coupon-value.data';

function discount(
  id: string,
  combinability: CouponCombinability,
): AppliedDiscount {
  return {
    id,
    source: AppliedDiscountSource.Manual,
    value: CouponValue.freeService(),
    label: 'На заведението',
    grantId: null,
    code: null,
    appliedAtMs: 1,
    combinability,
  };
}

const STACK_A = discount('a', CouponCombinability.stackable());
const STACK_B = discount('b', CouponCombinability.stackable());
const ALONE = discount('x', CouponCombinability.exclusive());

describe('AppliedDiscountSource', () => {
  it('keeps the stored source strings unchanged', () => {
    expect(Object.values(AppliedDiscountSource).sort()).toEqual([
      'code',
      'grant',
      'manual',
    ]);
  });
});

describe('AppliedDiscount — the legal set', () => {
  it('knows an exclusive discount', () => {
    expect(AppliedDiscount.isExclusive(ALONE)).toBe(true);
    expect(AppliedDiscount.isExclusive(STACK_A)).toBe(false);
  });

  it('lets stackable promises share the bill and keeps an exclusive one alone', () => {
    expect(AppliedDiscount.isLegalSelection([])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([STACK_A, STACK_B])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([ALONE])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([ALONE, STACK_A])).toBe(false);
    expect(AppliedDiscount.isLegalSelection([STACK_A, ALONE])).toBe(false);
  });

  it('never counts one promise twice', () => {
    expect(AppliedDiscount.isLegalSelection([STACK_A, STACK_A])).toBe(false);
  });
});
