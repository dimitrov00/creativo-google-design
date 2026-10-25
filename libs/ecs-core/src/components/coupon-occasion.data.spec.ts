import { describe, expect, it } from 'vitest';
import { CouponOccasion } from './coupon-occasion.data';
import { CouponStatus } from './coupon-status.data';

// The occasion cases of `coupon.spec.ts`.

describe('CouponOccasion', () => {
  it('is a closed set of one', () => {
    expect(Object.values(CouponOccasion)).toEqual(['BIRTHDAY']);
    expect(CouponOccasion.Birthday).toBe('BIRTHDAY');
  });
});

describe('CouponStatus', () => {
  it('replaces the boolean `enabled` with two tags', () => {
    expect(Object.values(CouponStatus)).toEqual(['ENABLED', 'DISABLED']);
  });
});
