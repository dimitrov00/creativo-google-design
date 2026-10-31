import { describe, expect, it } from 'vitest';
import { Currency, PriceCents } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { CouponValue, DiscountMethod } from './coupon-value.data';

// The cases of `coupon-value.spec.ts`, on the flat variant slice.

const cents = (minor: number): PriceCents => unwrapOk(PriceCents.signed(minor));

describe('CouponValue.percentOff', () => {
  it.each([0, 15, 50, 100])('accepts %s %', (percent) => {
    expect(CouponValue.percentOff(percent)).toEqual({
      ok: true,
      value: { discountMethod: 'PERCENT_OFF', discountPercent: percent },
    });
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s %',
    (percent) => {
      expect(CouponValue.percentOff(percent)).toEqual({
        ok: false,
        error: {
          errorCode: 'ENGAGEMENT_COUPON_VALUE_INVALID_PERCENTAGE',
          attempted: percent,
        },
      });
    },
  );
});

describe('CouponValue.fixedAmount', () => {
  it('accepts a positive amount, flat beside its own currency', () => {
    expect(CouponValue.fixedAmount(cents(1000), Currency.EUR)).toEqual({
      ok: true,
      value: {
        discountMethod: 'FIXED_AMOUNT',
        discountAmountCents: 1000,
        discountCurrency: 'EUR',
      },
    });
  });

  it.each([0, -500])(
    'rejects %s cents: a zero-value coupon is no discount',
    (minor) => {
      expect(CouponValue.fixedAmount(cents(minor), Currency.EUR)).toEqual({
        ok: false,
        error: {
          errorCode: 'ENGAGEMENT_COUPON_VALUE_NEGATIVE_AMOUNT',
          attemptedCents: minor,
        },
      });
    },
  );
});

describe('CouponValue.positiveAmount — a fixed amount’s figure, no currency', () => {
  it.each([1, 1000])('accepts %s cents as they are', (minor) => {
    expect(CouponValue.positiveAmount(cents(minor))).toEqual({
      ok: true,
      value: minor,
    });
  });

  it.each([0, -1, -500])('refuses %s cents, as fixedAmount does', (minor) => {
    const refusal = {
      ok: false,
      error: {
        errorCode: 'ENGAGEMENT_COUPON_VALUE_NEGATIVE_AMOUNT',
        attemptedCents: minor,
      },
    };
    expect(CouponValue.positiveAmount(cents(minor))).toEqual(refusal);
    expect(CouponValue.fixedAmount(cents(minor), Currency.EUR)).toEqual(
      refusal,
    );
  });

  it('is pure: same input → same output', () => {
    expect(CouponValue.positiveAmount(cents(250))).toEqual(
      CouponValue.positiveAmount(cents(250)),
    );
  });
});

describe('CouponValue.freeService', () => {
  it('is the bare marker', () => {
    expect(CouponValue.freeService()).toEqual({
      discountMethod: 'FREE_SERVICE',
    });
    expect(Object.values(DiscountMethod)).toEqual([
      'PERCENT_OFF',
      'FIXED_AMOUNT',
      'FREE_SERVICE',
    ]);
  });
});

describe('CouponValue.sliceOf', () => {
  it('copies exactly the variant fields of a value-carrying struct', () => {
    const carrier = {
      grantStatus: 'ACTIVE',
      discountMethod: DiscountMethod.FixedAmount,
      discountAmountCents: cents(500),
      discountCurrency: Currency.EUR,
    } as const;
    expect(CouponValue.sliceOf(carrier)).toEqual({
      discountMethod: 'FIXED_AMOUNT',
      discountAmountCents: 500,
      discountCurrency: 'EUR',
    });
    expect(CouponValue.sliceOf(unwrapOk(CouponValue.percentOff(15)))).toEqual({
      discountMethod: 'PERCENT_OFF',
      discountPercent: 15,
    });
    expect(CouponValue.sliceOf(CouponValue.freeService())).toBe(
      CouponValue.freeService(),
    );
  });
});

describe('CouponValue.methodRank / magnitude', () => {
  const fixed = unwrapOk(CouponValue.fixedAmount(cents(2000), Currency.EUR));
  const percent = unwrapOk(CouponValue.percentOff(15));
  const free = CouponValue.freeService();

  it('ranks fixed before percent before free_service', () => {
    expect(CouponValue.methodRank(fixed)).toBeLessThan(
      CouponValue.methodRank(percent),
    );
    expect(CouponValue.methodRank(percent)).toBeLessThan(
      CouponValue.methodRank(free),
    );
    expect([fixed, percent, free].map(CouponValue.methodRank)).toEqual([
      0, 1, 2,
    ]);
  });

  it('reads the magnitude as percent or cents', () => {
    expect(CouponValue.magnitude(percent)).toBe(15);
    expect(CouponValue.magnitude(fixed)).toBe(2000);
    expect(CouponValue.magnitude(free)).toBe(0);
  });
});

describe('CouponValue.manualPercentOff — the percent the counter types (DEP-6)', () => {
  it.each([1, 15, 100])('accepts %s %', (percent) => {
    expect(CouponValue.manualPercentOff(percent)).toEqual({
      ok: true,
      value: { discountMethod: 'PERCENT_OFF', discountPercent: percent },
    });
  });

  it.each([0, 12.5, 101, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s % — a zero promises nothing, the counter never types a fraction',
    (percent) => {
      expect(CouponValue.manualPercentOff(percent)).toEqual({
        ok: false,
        error: {
          errorCode: 'ENGAGEMENT_COUPON_VALUE_INVALID_PERCENTAGE',
          attempted: percent,
        },
      });
    },
  );

  it('is stricter than the stored-coupon guard, which keeps 0 and fractions', () => {
    expect(CouponValue.percentOff(0).ok).toBe(true);
    expect(CouponValue.percentOff(12.5).ok).toBe(true);
    expect(CouponValue.manualPercentOff(0).ok).toBe(false);
    expect(CouponValue.manualPercentOff(12.5).ok).toBe(false);
  });
});

describe('CouponValue.same — one value, whatever carries it (OR-15)', () => {
  const percent = (value: number) => unwrapOk(CouponValue.percentOff(value));
  const fixed = (minor: number, currency: Currency = Currency.EUR) =>
    unwrapOk(CouponValue.fixedAmount(cents(minor), currency));

  it('holds for the same method and the same figure', () => {
    expect(CouponValue.same(percent(10), percent(10))).toBe(true);
    expect(CouponValue.same(fixed(500), fixed(500))).toBe(true);
    expect(
      CouponValue.same(CouponValue.freeService(), CouponValue.freeService()),
    ).toBe(true);
    // Read off the value slice of a wider struct, as a grant carries it.
    const carrier = { ...percent(15), grantStatus: 'ACTIVE' } as const;
    expect(CouponValue.same(carrier, percent(15))).toBe(true);
  });

  it('tells another figure, another currency and another method apart', () => {
    expect(CouponValue.same(percent(10), percent(20))).toBe(false);
    expect(CouponValue.same(fixed(500), fixed(600))).toBe(false);
    expect(CouponValue.same(fixed(500), fixed(500, Currency.BGN))).toBe(false);
    // 10 % off and 10 cents off share a magnitude, never a value.
    expect(CouponValue.same(percent(10), fixed(10))).toBe(false);
    expect(CouponValue.same(fixed(10), percent(10))).toBe(false);
    expect(CouponValue.same(CouponValue.freeService(), percent(100))).toBe(
      false,
    );
    expect(CouponValue.same(percent(100), CouponValue.freeService())).toBe(
      false,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const a = deepFreeze(fixed(500));
    const b = deepFreeze(fixed(500));
    expect(CouponValue.same(a, b)).toBe(CouponValue.same(a, b));
    expect(a.discountAmountCents).toBe(500);
  });
});
