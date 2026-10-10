import { describe, expect, it } from 'vitest';
import { CouponExpiry, CouponExpiryKind } from './coupon-expiry.data';

// The `CouponExpiry` and `Coupon.isWithinExpiry` cases of `coupon.spec.ts`,
// over epoch ms. Literal UTC instants of Sofia midnights (EET, UTC+2).
const GRANTED = Date.UTC(2025, 11, 31, 22); // 2026-01-01T00:00 Europe/Sofia
const WITHIN = Date.UTC(2026, 0, 14, 22); //   2026-01-15T00:00 Europe/Sofia
const PAST = Date.UTC(2026, 1, 28, 22); //     2026-03-01T00:00 Europe/Sofia
const FIXED = Date.UTC(2026, 0, 9, 22); //     2026-01-10T00:00 Europe/Sofia
const DAY = 86_400_000;

describe('CouponExpiry factories', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(CouponExpiryKind)).toEqual([
      'never',
      'days',
      'fixed_date',
    ]);
    expect(CouponExpiry.never()).toEqual({ kind: 'never' });
    expect(CouponExpiry.fixedDate(FIXED)).toEqual({
      kind: 'fixed_date',
      atMs: FIXED,
    });
  });

  it('days() accepts a positive integer', () => {
    expect(CouponExpiry.days(30)).toEqual({
      ok: true,
      value: { kind: 'days', days: 30 },
    });
  });

  it.each([0, -1, 2.5, Number.NaN])('days() rejects %s', (days) => {
    expect(CouponExpiry.days(days)).toEqual({
      ok: false,
      error: { code: 'engagement.coupon.invalid_expiry_days', attempted: days },
    });
  });
});

describe('CouponExpiry.isWithin', () => {
  it('never expires', () => {
    expect(CouponExpiry.isWithin(CouponExpiry.never(), GRANTED, PAST)).toBe(
      true,
    );
  });

  it('respects a days-based expiry', () => {
    const thirty = { kind: 'days', days: 30 } as const;
    expect(CouponExpiry.isWithin(thirty, GRANTED, WITHIN)).toBe(true);
    expect(CouponExpiry.isWithin(thirty, GRANTED, PAST)).toBe(false);
  });

  it('counts whole 24-hour days from the grant, both ends inclusive', () => {
    const one = { kind: 'days', days: 1 } as const;
    expect(CouponExpiry.isWithin(one, GRANTED, GRANTED + DAY)).toBe(true);
    expect(CouponExpiry.isWithin(one, GRANTED, GRANTED + DAY + 1)).toBe(false);
  });

  it('respects a fixed-date expiry, inclusive', () => {
    const fixed = CouponExpiry.fixedDate(FIXED);
    expect(CouponExpiry.isWithin(fixed, GRANTED, WITHIN)).toBe(false);
    expect(CouponExpiry.isWithin(fixed, GRANTED, FIXED)).toBe(true);
    expect(CouponExpiry.isWithin(fixed, GRANTED, FIXED + 1)).toBe(false);
  });
});
