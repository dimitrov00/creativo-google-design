import { describe, expect, it } from 'vitest';
import { UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { unwrapOk } from '../testing';
import {
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiry,
  GrantExpiryTerms,
  GrantLifecycle,
  GrantStatus,
} from './grant-status.data';

// The capacity / expiry factory cases of `coupon-grant.spec.ts`; the
// lifecycle (`burn`, `restore`, `expire`, `revoke`, `isUsable`) is
// CouponGrantSystem's.

const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

describe('the grant vocabularies', () => {
  it('keeps one SCREAMING tag per state', () => {
    expect(Object.values(GrantStatus)).toEqual([
      'ACTIVE',
      'USED',
      'EXPIRED',
      'REVOKED',
    ]);
    expect(Object.values(GrantCapacity)).toEqual(['SINGLE_USE', 'MULTI_USE']);
    expect(Object.values(GrantExpiry)).toEqual(['NO_EXPIRY', 'EXPIRES_AT']);
  });
});

describe('GrantCapacityTerms', () => {
  it('builds a single-use capacity', () => {
    expect(GrantCapacityTerms.singleUse()).toEqual({
      grantCapacity: 'SINGLE_USE',
    });
  });

  it('builds a multi-use capacity with every use remaining', () => {
    expect(GrantCapacityTerms.multiUse(3)).toEqual({
      ok: true,
      value: { grantCapacity: 'MULTI_USE', usesRemaining: 3, usesGranted: 3 },
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a multi-use capacity of %s',
    (total) => {
      expect(GrantCapacityTerms.multiUse(total)).toEqual({
        ok: false,
        error: {
          errorCode: 'ENGAGEMENT_COUPON_GRANT_INVALID_CAPACITY',
          attempted: total,
        },
      });
    },
  );
});

describe('GrantExpiryTerms', () => {
  it('builds no expiry and an absolute one', () => {
    expect(GrantExpiryTerms.none()).toEqual({ grantExpiry: 'NO_EXPIRY' });
    expect(GrantExpiryTerms.at(at(1_767_225_600_000))).toEqual({
      grantExpiry: 'EXPIRES_AT',
      grantExpiresAtUtcMs: 1_767_225_600_000,
    });
  });
});

describe('GrantLifecycle', () => {
  it('starts a fresh grant active, with its capacity and expiry flat beside it', () => {
    const lifecycle = GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.none(),
    );
    expect(lifecycle).toEqual({
      grantStatus: 'ACTIVE',
      grantCapacity: 'SINGLE_USE',
      grantExpiry: 'NO_EXPIRY',
    });
    expect(GrantLifecycle.isActive(lifecycle)).toBe(true);
  });

  it('tells a spent grant from an active one', () => {
    const used = GrantLifecycle.used(at(1), '');
    expect(used).toEqual({ grantStatus: 'USED', usedAtUtcMs: 1, usedNote: '' });
    expect(GrantLifecycle.isActive(used)).toBe(false);
  });

  it('copies exactly its variant out of a whole grant', () => {
    const multi = unwrapOk(GrantCapacityTerms.multiUse(2));
    const active = GrantLifecycle.active(multi, GrantExpiryTerms.at(at(9)));
    const grant = { ...active, couponId: 'c-1' };
    expect(GrantLifecycle.of(grant)).toEqual(active);
    const expired = GrantLifecycle.expired(at(5), at(4));
    expect(GrantLifecycle.of(expired)).toEqual({
      grantStatus: 'EXPIRED',
      expiredAtUtcMs: 5,
      expiryScheduledAtUtcMs: 4,
    });
    const revoked = GrantLifecycle.revoked(
      at(6),
      UserId.of('u-admin'),
      'abuse',
    );
    expect(GrantLifecycle.of(revoked)).toEqual({
      grantStatus: 'REVOKED',
      revokedAtUtcMs: 6,
      revokedByUserId: 'u-admin',
      revocationReason: 'abuse',
    });
  });
});
