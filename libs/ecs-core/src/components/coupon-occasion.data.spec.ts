import { describe, expect, it } from 'vitest';
import {
  COUPON_OCCASIONS,
  CouponOccasion,
  CouponStatus,
  isCouponOccasion,
  parseCouponOccasion,
} from './coupon-occasion.data';

// The occasion cases of `coupon.spec.ts`.

describe('CouponOccasion', () => {
  it('is a closed set of one', () => {
    expect(COUPON_OCCASIONS).toEqual(['birthday']);
    expect(CouponOccasion.Birthday).toBe('birthday');
  });

  it.each([[null], [undefined]])('reads %s as no occasion', (raw) => {
    expect(parseCouponOccasion(raw)).toEqual({ ok: true, value: null });
  });

  it('takes every known occasion', () => {
    for (const occasion of COUPON_OCCASIONS) {
      expect(parseCouponOccasion(occasion)).toEqual({
        ok: true,
        value: occasion,
      });
      expect(isCouponOccasion(occasion)).toBe(true);
    }
  });

  it.each([['nameday'], ['Birthday'], [' birthday'], [''], [0], [true]])(
    'refuses %j: a word the card does not know is never "no occasion"',
    (raw) => {
      expect(parseCouponOccasion(raw)).toEqual({
        ok: false,
        error: { code: 'engagement.coupon.occasion_unknown', attempted: raw },
      });
      expect(isCouponOccasion(raw)).toBe(false);
    },
  );

  it('flattens an attempted object to a string parameter', () => {
    const result = parseCouponOccasion({});
    expect(result.ok ? null : result.error.attempted).toBe('[object Object]');
  });
});

describe('CouponStatus', () => {
  it('replaces the boolean `enabled` with two tags', () => {
    expect(Object.values(CouponStatus)).toEqual(['enabled', 'disabled']);
  });
});
