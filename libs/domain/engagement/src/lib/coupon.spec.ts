import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { CouponCombinability } from './coupon-combinability';
import { CouponValue } from './coupon-value';
import { Coupon, CouponExpiry } from './coupon';

function percentOff(percent: number) {
  const r = CouponValue.percentOff(percent);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

describe('CouponExpiry', () => {
  it('days() rejects a non-positive day count', () => {
    expect(CouponExpiry.days(0).isFailure()).toBe(true);
    expect(CouponExpiry.days(-1).isFailure()).toBe(true);
  });

  it('days() accepts a positive integer', () => {
    const result = CouponExpiry.days(30);
    expect(result.isSuccess()).toBe(true);
  });
});

describe('Coupon.create', () => {
  const baseProps = {
    id: 'coupon-1',
    name: 'Welcome 15% off',
    value: percentOff(15),
    combinability: CouponCombinability.stackable(),
    expiry: CouponExpiry.never(),
    enabled: true,
  };

  it('creates a valid coupon', () => {
    const result = Coupon.create(baseProps);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name).toBe('Welcome 15% off');
    }
  });

  it('rejects an empty id', () => {
    const result = Coupon.create({ ...baseProps, id: '' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = Coupon.create({ ...baseProps, name: '   ' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a non-positive usage limit', () => {
    const result = Coupon.create({ ...baseProps, usageLimit: 0 });
    expect(result.isFailure()).toBe(true);
  });

  it('collects multiple field errors at once', () => {
    const result = Coupon.create({
      ...baseProps,
      id: '',
      name: '',
      usageLimit: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(3);
    }
  });

  it('accepts a valid usage limit', () => {
    const result = Coupon.create({ ...baseProps, usageLimit: 100 });
    expect(result.isSuccess()).toBe(true);
  });
});

function mustSucceed(
  result: ReturnType<typeof ZonedDateTime.fromISO>,
): ZonedDateTime {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('Coupon.isWithinExpiry', () => {
  const zone = 'Europe/Sofia';
  const grantedAt = mustSucceed(
    ZonedDateTime.fromISO('2026-01-01T00:00:00', zone),
  );
  const withinDays = mustSucceed(
    ZonedDateTime.fromISO('2026-01-15T00:00:00', zone),
  );
  const pastDays = mustSucceed(
    ZonedDateTime.fromISO('2026-03-01T00:00:00', zone),
  );

  it('never expires', () => {
    const result = Coupon.create({
      id: 'c1',
      name: 'x',
      value: percentOff(10),
      combinability: CouponCombinability.stackable(),
      expiry: CouponExpiry.never(),
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.isWithinExpiry(grantedAt, pastDays)).toBe(true);
  });

  it('days-based expiry is respected', () => {
    const daysResult = CouponExpiry.days(30);
    if (daysResult.isFailure()) throw new Error('bad fixture');
    const result = Coupon.create({
      id: 'c1',
      name: 'x',
      value: percentOff(10),
      combinability: CouponCombinability.stackable(),
      expiry: daysResult.value,
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.isWithinExpiry(grantedAt, withinDays)).toBe(true);
    expect(result.value.isWithinExpiry(grantedAt, pastDays)).toBe(false);
  });

  it('fixed-date expiry is respected', () => {
    const at = ZonedDateTime.fromISO('2026-01-10T00:00:00', zone);
    if (at.isFailure()) throw new Error('bad fixture');
    const result = Coupon.create({
      id: 'c1',
      name: 'x',
      value: percentOff(10),
      combinability: CouponCombinability.stackable(),
      expiry: CouponExpiry.fixedDate(at.value),
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.isWithinExpiry(grantedAt, withinDays)).toBe(false);
  });
});

describe('Coupon with Money-based value', () => {
  it('supports a fixed-amount coupon value', () => {
    const money = Money.fromMinorUnitsAndCode(1000, 'EUR');
    if (money.isFailure()) throw new Error('bad fixture');
    const value = CouponValue.fixedAmount(money.value);
    expect(value.isSuccess()).toBe(true);
  });
});
