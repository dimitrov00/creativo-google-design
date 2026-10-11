import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { utcMs } from '../testing';
import { CouponExpiry, CouponExpiryRule } from './coupon-expiry.data';

// The `CouponExpiry` and `Coupon.isWithinExpiry` cases of `coupon.spec.ts`,
// over epoch ms. Sofia midnights (EET, UTC+2), named with their offset.
const GRANTED = utcMs('2026-01-01T00:00:00+02:00');
const WITHIN = utcMs('2026-01-15T00:00:00+02:00');
const PAST = utcMs('2026-03-01T00:00:00+02:00');
const FIXED = utcMs('2026-01-10T00:00:00+02:00');
const DAY = 86_400_000;

describe('CouponExpiryRule factories', () => {
  it('keeps one SCREAMING tag per rule', () => {
    expect(Object.values(CouponExpiry)).toEqual([
      'NEVER',
      'DAYS',
      'FIXED_DATE',
    ]);
    expect(CouponExpiryRule.never()).toEqual({ couponExpiry: 'NEVER' });
    expect(CouponExpiryRule.fixedDate(FIXED)).toEqual({
      couponExpiry: 'FIXED_DATE',
      expiresAtUtcMs: FIXED,
    });
  });

  it('days() accepts a positive integer', () => {
    expect(CouponExpiryRule.days(30)).toEqual({
      ok: true,
      value: { couponExpiry: 'DAYS', expiryDays: 30 },
    });
  });

  it.each([0, -1, 2.5, Number.NaN])('days() rejects %s', (days) => {
    expect(CouponExpiryRule.days(days)).toEqual({
      ok: false,
      error: {
        errorCode: 'ENGAGEMENT_COUPON_INVALID_EXPIRY_DAYS',
        attempted: days,
      },
    });
  });
});

describe('CouponExpiryRule.isWithin', () => {
  it('never expires', () => {
    expect(
      CouponExpiryRule.isWithin(CouponExpiryRule.never(), GRANTED, PAST),
    ).toBe(true);
  });

  it('respects a days-based expiry', () => {
    const thirty = { couponExpiry: 'DAYS', expiryDays: 30 } as const;
    expect(CouponExpiryRule.isWithin(thirty, GRANTED, WITHIN)).toBe(true);
    expect(CouponExpiryRule.isWithin(thirty, GRANTED, PAST)).toBe(false);
  });

  it('counts whole 24-hour days from the grant, both ends inclusive', () => {
    const one = { couponExpiry: 'DAYS', expiryDays: 1 } as const;
    expect(
      CouponExpiryRule.isWithin(one, GRANTED, UtcEpochMs.plusMs(GRANTED, DAY)),
    ).toBe(true);
    expect(
      CouponExpiryRule.isWithin(
        one,
        GRANTED,
        UtcEpochMs.plusMs(GRANTED, DAY + 1),
      ),
    ).toBe(false);
  });

  it('respects a fixed-date expiry, inclusive', () => {
    const fixed = CouponExpiryRule.fixedDate(FIXED);
    expect(CouponExpiryRule.isWithin(fixed, GRANTED, WITHIN)).toBe(false);
    expect(CouponExpiryRule.isWithin(fixed, GRANTED, FIXED)).toBe(true);
    expect(
      CouponExpiryRule.isWithin(fixed, GRANTED, UtcEpochMs.plusMs(FIXED, 1)),
    ).toBe(false);
  });
});
