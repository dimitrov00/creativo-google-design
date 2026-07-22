import { Money } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { CouponValue } from './coupon-value';
import {
  InvalidCouponPercentageError,
  NegativeCouponAmountError,
} from './coupon-value.errors';

function money(major: number): Money {
  const r = Money.fromMinorUnitsAndCode(major * 100, 'EUR');
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

describe('CouponValue.percentOff', () => {
  it('accepts a percentage within 0-100', () => {
    const result = CouponValue.percentOff(50);
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a negative percentage', () => {
    const result = CouponValue.percentOff(-1);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidCouponPercentageError);
    }
  });

  it('rejects a percentage above 100', () => {
    expect(CouponValue.percentOff(101).isFailure()).toBe(true);
  });

  it('rejects a non-finite percentage', () => {
    expect(CouponValue.percentOff(Number.NaN).isFailure()).toBe(true);
  });
});

describe('CouponValue.fixedAmount', () => {
  it('accepts a positive amount', () => {
    expect(CouponValue.fixedAmount(money(10)).isSuccess()).toBe(true);
  });

  it('rejects a zero amount', () => {
    const result = CouponValue.fixedAmount(money(0));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(NegativeCouponAmountError);
    }
  });
});

describe('CouponValue.freeService', () => {
  it('always returns the same free-service marker', () => {
    expect(CouponValue.freeService().kind).toBe('free_service');
  });
});

describe('CouponValue.kindRank / magnitude', () => {
  it('ranks fixed before percent before free_service', () => {
    const fixed = CouponValue.fixedAmount(money(10));
    const percent = CouponValue.percentOff(10);
    if (fixed.isFailure() || percent.isFailure())
      throw new Error('bad fixture');
    expect(CouponValue.kindRank(fixed.value)).toBeLessThan(
      CouponValue.kindRank(percent.value),
    );
    expect(CouponValue.kindRank(percent.value)).toBeLessThan(
      CouponValue.kindRank(CouponValue.freeService()),
    );
  });

  it('magnitude reflects percent/minor-units respectively', () => {
    const percent = CouponValue.percentOff(15);
    const fixed = CouponValue.fixedAmount(money(20));
    if (percent.isFailure() || fixed.isFailure())
      throw new Error('bad fixture');
    expect(CouponValue.magnitude(percent.value)).toBe(15);
    expect(CouponValue.magnitude(fixed.value)).toBe(2000);
    expect(CouponValue.magnitude(CouponValue.freeService())).toBe(0);
  });
});
