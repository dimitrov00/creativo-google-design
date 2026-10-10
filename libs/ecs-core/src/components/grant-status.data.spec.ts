import { describe, expect, it } from 'vitest';
import {
  CouponGrantCapacity,
  CouponGrantExpiration,
  GrantCapacityKind,
  GrantExpirationKind,
  GrantState,
  GrantStatus,
} from './grant-status.data';

// The capacity / expiration factory cases of `coupon-grant.spec.ts`; the
// lifecycle (`burn`, `restore`, `expire`, `revoke`, `isUsable`) is
// CouponGrantSystem's, Phase 2.

describe('the grant vocabularies', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(GrantState)).toEqual([
      'active',
      'used',
      'expired',
      'revoked',
    ]);
    expect(Object.values(GrantCapacityKind)).toEqual([
      'single_use',
      'multi_use',
    ]);
    expect(Object.values(GrantExpirationKind)).toEqual([
      'no_expiry',
      'expires_at',
    ]);
  });
});

describe('CouponGrantCapacity', () => {
  it('builds a single-use capacity', () => {
    expect(CouponGrantCapacity.singleUse()).toEqual({ kind: 'single_use' });
  });

  it('builds a multi-use capacity with every use remaining', () => {
    expect(CouponGrantCapacity.multiUse(3)).toEqual({
      ok: true,
      value: { kind: 'multi_use', remaining: 3, totalGranted: 3 },
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a multi-use capacity of %s',
    (total) => {
      expect(CouponGrantCapacity.multiUse(total)).toEqual({
        ok: false,
        error: {
          code: 'engagement.coupon_grant.invalid_capacity',
          attempted: total,
        },
      });
    },
  );
});

describe('CouponGrantExpiration', () => {
  it('builds no expiry and an absolute one', () => {
    expect(CouponGrantExpiration.none()).toEqual({ kind: 'no_expiry' });
    expect(CouponGrantExpiration.at(1_767_225_600_000)).toEqual({
      kind: 'expires_at',
      atMs: 1_767_225_600_000,
    });
  });
});

describe('GrantStatus', () => {
  it('starts a fresh grant active, with its capacity and expiration', () => {
    const status = GrantStatus.active(
      CouponGrantCapacity.singleUse(),
      CouponGrantExpiration.none(),
    );
    expect(status).toEqual({
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    });
    expect(GrantStatus.isActive(status)).toBe(true);
  });

  it('tells a spent grant from an active one', () => {
    const used: GrantStatus = { kind: 'used', usedAtMs: 1, note: '' };
    expect(GrantStatus.isActive(used)).toBe(false);
  });
});
