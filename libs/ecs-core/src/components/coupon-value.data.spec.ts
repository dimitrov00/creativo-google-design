import { describe, expect, it } from 'vitest';
import { CouponValue, CouponValueKind } from './coupon-value.data';
import type { Money } from './money.data';

// The cases of `coupon-value.spec.ts`, on the plain union.

const eur = (minor: number): Money => ({
  amountMinorUnits: minor,
  currencyCode: 'EUR',
});

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('CouponValue.percentOff', () => {
  it.each([0, 15, 50, 100])('accepts %s %', (percent) => {
    expect(CouponValue.percentOff(percent)).toEqual({
      ok: true,
      value: { kind: 'percent_off', percent },
    });
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s %',
    (percent) => {
      expect(CouponValue.percentOff(percent)).toEqual({
        ok: false,
        error: {
          code: 'engagement.coupon_value.invalid_percentage',
          attempted: percent,
        },
      });
    },
  );
});

describe('CouponValue.fixedAmount', () => {
  it('accepts a positive amount, nested as Money', () => {
    expect(CouponValue.fixedAmount(eur(1000))).toEqual({
      ok: true,
      value: {
        kind: 'fixed_amount',
        amount: { amountMinorUnits: 1000, currencyCode: 'EUR' },
      },
    });
  });

  it.each([0, -500])(
    'rejects %s minor units: a zero-value coupon is no discount',
    (minor) => {
      expect(CouponValue.fixedAmount(eur(minor))).toEqual({
        ok: false,
        error: {
          code: 'engagement.coupon_value.negative_amount',
          attemptedMinorUnits: minor,
        },
      });
    },
  );
});

describe('CouponValue.freeService', () => {
  it('is the bare stored marker', () => {
    expect(CouponValue.freeService()).toEqual({ kind: 'free_service' });
    expect(Object.values(CouponValueKind)).toEqual([
      'percent_off',
      'fixed_amount',
      'free_service',
    ]);
  });
});

describe('CouponValue.kindRank / magnitude', () => {
  const fixed = must(CouponValue.fixedAmount(eur(2000)));
  const percent = must(CouponValue.percentOff(15));
  const free = CouponValue.freeService();

  it('ranks fixed before percent before free_service', () => {
    expect(CouponValue.kindRank(fixed)).toBeLessThan(
      CouponValue.kindRank(percent),
    );
    expect(CouponValue.kindRank(percent)).toBeLessThan(
      CouponValue.kindRank(free),
    );
    expect([fixed, percent, free].map(CouponValue.kindRank)).toEqual([0, 1, 2]);
  });

  it('reads the magnitude as percent or minor units', () => {
    expect(CouponValue.magnitude(percent)).toBe(15);
    expect(CouponValue.magnitude(fixed)).toBe(2000);
    expect(CouponValue.magnitude(free)).toBe(0);
  });
});
