import { describe, expect, it } from 'vitest';
import { AppliedDiscountId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { unwrapOk } from '../testing';
import { AppliedDiscount } from './applied-discount.data';
import { Combinability } from './coupon-combinability.data';
import { CouponValue } from './coupon-value.data';
import { DiscountSource } from './discount-provenance.data';

function discount(id: string, combinability: Combinability): AppliedDiscount {
  return {
    discountId: AppliedDiscountId.of(id),
    discountSource: DiscountSource.Manual,
    label: 'На заведението',
    appliedAtUtcMs: unwrapOk(UtcEpochMs.of(1)),
    combinability,
    ...CouponValue.freeService(),
  };
}

const STACK_A = discount('a', Combinability.Stackable);
const STACK_B = discount('b', Combinability.Stackable);
const ALONE = discount('x', Combinability.Exclusive);

describe('DiscountSource', () => {
  it('keeps one SCREAMING tag per source', () => {
    expect(Object.values(DiscountSource).sort()).toEqual([
      'CODE',
      'GRANT',
      'MANUAL',
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
