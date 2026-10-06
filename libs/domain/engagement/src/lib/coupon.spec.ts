import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { CouponCombinability } from './coupon-combinability';
import { CouponValue } from './coupon-value';
import {
  COUPON_OCCASIONS,
  Coupon,
  CouponExpiry,
  CreateCouponProps,
} from './coupon';
import { CouponOccasionUnknownError } from './coupon.errors';

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

describe('Coupon, the occasion', () => {
  const baseProps: CreateCouponProps = {
    id: 'coupon-birthday',
    name: 'Рожден ден −20 %',
    value: percentOff(20),
    combinability: CouponCombinability.stackable(),
    expiry: CouponExpiry.never(),
    enabled: true,
  };
  /** A document is untrusted text: what a mapper hands over is not yet an occasion. */
  const withOccasion = (occasion: unknown): CreateCouponProps =>
    ({ ...baseProps, occasion }) as CreateCouponProps;

  it('is none by default: a coupon written before occasions existed', () => {
    for (const build of [Coupon.create, Coupon.reconstitute]) {
      const result = build(baseProps);
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) expect(result.value.occasion).toBeNull();
    }
  });

  it.each([[null], [undefined]])('reads %s as no occasion', (occasion) => {
    const result = Coupon.reconstitute(withOccasion(occasion));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) expect(result.value.occasion).toBeNull();
  });

  it.each(COUPON_OCCASIONS.map((occasion) => [occasion]))(
    'keeps %s, created or read back',
    (occasion) => {
      for (const build of [Coupon.create, Coupon.reconstitute]) {
        const result = build({ ...baseProps, occasion });
        expect(result.isSuccess()).toBe(true);
        if (result.isSuccess()) expect(result.value.occasion).toBe(occasion);
      }
    },
  );

  it('is a closed set of one', () => {
    expect(COUPON_OCCASIONS).toEqual(['birthday']);
  });

  it.each([['nameday'], ['Birthday'], [' birthday'], [''], [0], [true], [{}]])(
    'refuses %j: a word the card does not know is never "no occasion"',
    (occasion) => {
      const result = Coupon.reconstitute(withOccasion(occasion));
      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toHaveLength(1);
        const [error] = result.error;
        expect(error).toBeInstanceOf(CouponOccasionUnknownError);
        expect(error?.code).toBe('engagement.coupon.occasion_unknown');
        expect(error?.params).toEqual({ attempted: occasion });
      }
    },
  );

  it('is one fault among the others, all reported at once', () => {
    const result = Coupon.create({
      ...withOccasion('nameday'),
      id: '',
      name: ' ',
      usageLimit: 0,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.map((error) => error.code)).toEqual([
        'engagement.id.empty',
        'engagement.coupon.empty_name',
        'engagement.coupon.invalid_usage_limit',
        'engagement.coupon.occasion_unknown',
      ]);
    }
  });

  it('leaves the shareable code alone', () => {
    const result = Coupon.create({
      ...baseProps,
      code: ' first10 ',
      occasion: 'birthday',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.code).toBe('FIRST10');
      expect(result.value.occasion).toBe('birthday');
    }
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
