import { ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { CouponValue } from './coupon-value';
import {
  CouponGrant,
  CouponGrantCapacity,
  CouponGrantExpiration,
} from './coupon-grant';

const zone = 'Europe/Sofia';
function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function percentOff(percent: number): CouponValue {
  const r = CouponValue.percentOff(percent);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function makeActiveGrant(capacity: CouponGrantCapacity) {
  const result = CouponGrant.create({
    id: 'grant-1',
    userId: UserId.generate().toString(),
    couponId: 'coupon-1',
    value: percentOff(10),
    grantedAt: at('2026-01-01T00:00:00'),
    capacity,
    expiration: CouponGrantExpiration.none(),
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('CouponGrant.create', () => {
  it('creates an active grant', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    expect(grant.isActive()).toBe(true);
  });

  it('rejects an empty user id', () => {
    const result = CouponGrant.create({
      id: 'grant-1',
      userId: '',
      couponId: 'coupon-1',
      value: percentOff(10),
      grantedAt: at('2026-01-01T00:00:00'),
      capacity: CouponGrantCapacity.singleUse(),
      expiration: CouponGrantExpiration.none(),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('CouponGrantCapacity.multiUse rejects a non-positive total', () => {
    expect(CouponGrantCapacity.multiUse(0).isFailure()).toBe(true);
  });
});

describe('CouponGrant.markUsed', () => {
  it('single-use transitions straight to used', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const result = grant.markUsed(at('2026-01-02T00:00:00'));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.state.kind).toBe('used');
    }
  });

  it('multi-use decrements remaining and stays active until exhausted', () => {
    const capacity = CouponGrantCapacity.multiUse(2);
    if (capacity.isFailure()) throw new Error('bad fixture');
    const grant = makeActiveGrant(capacity.value);

    const first = grant.markUsed(at('2026-01-02T00:00:00'));
    expect(first.isSuccess()).toBe(true);
    if (first.isSuccess()) {
      expect(first.value.state.kind).toBe('active');

      const second = first.value.markUsed(at('2026-01-03T00:00:00'));
      expect(second.isSuccess()).toBe(true);
      if (second.isSuccess()) {
        expect(second.value.state.kind).toBe('used');
      }
    }
  });

  it('rejects marking an already-used grant as used again', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const used = grant.markUsed(at('2026-01-02T00:00:00'));
    if (used.isFailure()) throw new Error('bad fixture');
    const result = used.value.markUsed(at('2026-01-03T00:00:00'));
    expect(result.isFailure()).toBe(true);
  });
});

describe('CouponGrant.expire', () => {
  it('expires a grant with a scheduled expiration', () => {
    const capacity = CouponGrantCapacity.singleUse();
    const result = CouponGrant.create({
      id: 'grant-1',
      userId: UserId.generate().toString(),
      couponId: 'coupon-1',
      value: percentOff(10),
      grantedAt: at('2026-01-01T00:00:00'),
      capacity,
      expiration: CouponGrantExpiration.at(at('2026-02-01T00:00:00')),
    });
    if (result.isFailure()) throw new Error('bad fixture');
    const expired = result.value.expire(at('2026-02-02T00:00:00'));
    expect(expired.isSuccess()).toBe(true);
    if (expired.isSuccess()) {
      expect(expired.value.state.kind).toBe('expired');
    }
  });

  it('rejects expiring a grant with no scheduled expiration', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const result = grant.expire(at('2026-02-02T00:00:00'));
    expect(result.isFailure()).toBe(true);
  });
});

describe('CouponGrant.revoke', () => {
  it('revokes an active grant with a reason', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const result = grant.revoke(
      at('2026-01-05T00:00:00'),
      UserId.generate(),
      'fraud',
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.state.kind).toBe('revoked');
    }
  });

  it('rejects an empty revocation reason', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const result = grant.revoke(
      at('2026-01-05T00:00:00'),
      UserId.generate(),
      '  ',
    );
    expect(result.isFailure()).toBe(true);
  });

  it('rejects revoking a non-active grant', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const used = grant.markUsed(at('2026-01-02T00:00:00'));
    if (used.isFailure()) throw new Error('bad fixture');
    const result = used.value.revoke(
      at('2026-01-05T00:00:00'),
      UserId.generate(),
      'x',
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('CouponGrant.isUsable', () => {
  it('is usable while active and not past expiry', () => {
    const grant = CouponGrant.create({
      id: 'grant-1',
      userId: UserId.generate().toString(),
      couponId: 'coupon-1',
      value: percentOff(10),
      grantedAt: at('2026-01-01T00:00:00'),
      capacity: CouponGrantCapacity.singleUse(),
      expiration: CouponGrantExpiration.at(at('2026-02-01T00:00:00')),
    });
    if (grant.isFailure()) throw new Error('bad fixture');
    expect(grant.value.isUsable(at('2026-01-15T00:00:00'))).toBe(true);
    expect(grant.value.isUsable(at('2026-03-01T00:00:00'))).toBe(false);
  });

  it('is never usable once used', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const used = grant.markUsed(at('2026-01-02T00:00:00'));
    if (used.isFailure()) throw new Error('bad fixture');
    expect(used.value.isUsable(at('2026-01-03T00:00:00'))).toBe(false);
  });
});
