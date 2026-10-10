import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CouponOccasion } from '../components/coupon-occasion.data';
import { CouponValue } from '../components/coupon-value.data';
import { EngagementErrorCode } from '../components/engagement-errors.data';
import {
  CouponGrantCapacity,
  CouponGrantExpiration,
  GrantCapacityKind,
  GrantState,
  GrantStatus,
} from '../components/grant-status.data';
import {
  type CouponGrantEntity,
  CouponGrantId,
} from '../entities/coupon-grant.entity';
import { CouponId } from '../entities/coupon.entity';
import { UserId } from '../entities/user.entity';
import { deepFreeze, unwrapErr, unwrapOk } from '../testing';
import { type GrantTerms, CouponGrantSystem } from './coupon-grant.system';

/*
 * The cases of libs/domain/engagement/src/lib/coupon-grant.spec.ts, copied
 * over plain entities (the class spec keeps running against its shim):
 * `markUsed` is `burn`, instants are ms. Plus the inverse the visit editor's
 * undo needs (`restore`), as an exact-inverse property.
 */

const JAN_1 = Date.UTC(2025, 11, 31, 22, 0);
const DAY = 86_400_000;
const at = (days: number): number => JAN_1 + days * DAY;

function makeActiveGrant(
  capacity: CouponGrantCapacity,
  expiration: CouponGrantExpiration = CouponGrantExpiration.none(),
): CouponGrantEntity {
  return {
    id: CouponGrantId.of('grant-1'),
    userId: UserId.of('user-1'),
    couponId: CouponId.of('coupon-1'),
    value: unwrapOk(CouponValue.percentOff(10)),
    grantedAtMs: JAN_1,
    state: GrantStatus.active(capacity, expiration),
  };
}

function multiUse(total: number): CouponGrantCapacity {
  return unwrapOk(CouponGrantCapacity.multiUse(total));
}

describe('CouponGrantSystem — a fresh grant', () => {
  it('creates an active grant', () => {
    expect(
      CouponGrantSystem.isActive(
        makeActiveGrant(CouponGrantCapacity.singleUse()),
      ),
    ).toBe(true);
  });

  it('CouponGrantCapacity.multiUse rejects a non-positive total', () => {
    expect(CouponGrantCapacity.multiUse(0).ok).toBe(false);
  });
});

describe('CouponGrantSystem.burn', () => {
  it('single-use transitions straight to used', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(used.state).toEqual({
      kind: GrantState.Used,
      usedAtMs: at(1),
      note: '',
    });
  });

  it('multi-use decrements remaining and stays active until exhausted', () => {
    const grant = makeActiveGrant(multiUse(2));
    const first = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(first.state.kind).toBe('active');
    const second = unwrapOk(CouponGrantSystem.burn(first, at(2), 'appt-1'));
    expect(second.state).toEqual({
      kind: GrantState.Used,
      usedAtMs: at(2),
      note: 'appt-1',
    });
  });

  it('rejects marking an already-used grant as used again', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(CouponGrantCapacity.singleUse()),
        at(1),
        '',
      ),
    );
    expect(unwrapErr(CouponGrantSystem.burn(used, at(2), ''))).toEqual({
      code: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantState.Used,
    });
  });
});

describe('CouponGrantSystem.expire', () => {
  it('expires a grant with a scheduled expiration', () => {
    const grant = makeActiveGrant(
      CouponGrantCapacity.singleUse(),
      CouponGrantExpiration.at(at(31)),
    );
    const expired = unwrapOk(CouponGrantSystem.expire(grant, at(32)));
    expect(expired.state).toEqual({
      kind: GrantState.Expired,
      expiredAtMs: at(32),
      scheduledForMs: at(31),
    });
  });

  it('rejects expiring a grant with no scheduled expiration', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    expect(unwrapErr(CouponGrantSystem.expire(grant, at(32))).code).toBe(
      EngagementErrorCode.CouponGrantNotExpiring,
    );
  });
});

describe('CouponGrantSystem.revoke', () => {
  it('revokes an active grant with a reason', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    const revoked = unwrapOk(
      CouponGrantSystem.revoke(grant, at(4), UserId.of('admin'), '  fraud '),
    );
    expect(revoked.state).toEqual({
      kind: GrantState.Revoked,
      revokedAtMs: at(4),
      revokedBy: 'admin',
      reason: 'fraud',
    });
  });

  it('rejects an empty revocation reason', () => {
    const grant = makeActiveGrant(CouponGrantCapacity.singleUse());
    expect(
      unwrapErr(CouponGrantSystem.revoke(grant, at(4), UserId.of('a'), '  '))
        .code,
    ).toBe(EngagementErrorCode.CouponGrantReasonEmpty);
  });

  it('rejects revoking a non-active grant', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(CouponGrantCapacity.singleUse()),
        at(1),
        '',
      ),
    );
    expect(CouponGrantSystem.revoke(used, at(4), UserId.of('a'), 'x').ok).toBe(
      false,
    );
  });
});

describe('CouponGrantSystem.isUsable', () => {
  it('is usable while active and not past expiry', () => {
    const grant = makeActiveGrant(
      CouponGrantCapacity.singleUse(),
      CouponGrantExpiration.at(at(31)),
    );
    expect(CouponGrantSystem.isUsable(grant, at(14))).toBe(true);
    expect(CouponGrantSystem.isUsable(grant, at(31))).toBe(true);
    expect(CouponGrantSystem.isUsable(grant, at(59))).toBe(false);
  });

  it('is never usable once used', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(CouponGrantCapacity.singleUse()),
        at(1),
        '',
      ),
    );
    expect(CouponGrantSystem.isUsable(used, at(2))).toBe(false);
  });
});

describe('CouponGrantSystem.restore — the exact inverse of a burn', () => {
  it('brings a spent grant back as it was issued, one use on it', () => {
    const issued: GrantTerms = {
      capacity: CouponGrantCapacity.singleUse(),
      expiration: CouponGrantExpiration.at(at(31)),
    };
    const grant = makeActiveGrant(issued.capacity, issued.expiration);
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(unwrapOk(CouponGrantSystem.restore(used, issued))).toEqual(grant);
  });

  it('gives a multi-use grant its use back, up to what was granted', () => {
    const issued: GrantTerms = {
      capacity: multiUse(3),
      expiration: CouponGrantExpiration.none(),
    };
    const grant = makeActiveGrant(issued.capacity);
    expect(unwrapErr(CouponGrantSystem.restore(grant, issued))).toEqual({
      code: EngagementErrorCode.CouponGrantCapacityInvalid,
      attempted: 4,
    });
    expect(
      unwrapErr(
        CouponGrantSystem.restore(
          makeActiveGrant(CouponGrantCapacity.singleUse()),
          issued,
        ),
      ).code,
    ).toBe(EngagementErrorCode.CouponGrantCapacityInvalid);
  });

  it('refuses an expired or revoked grant', () => {
    const issued: GrantTerms = {
      capacity: CouponGrantCapacity.singleUse(),
      expiration: CouponGrantExpiration.at(at(31)),
    };
    const expired = unwrapOk(
      CouponGrantSystem.expire(
        makeActiveGrant(issued.capacity, issued.expiration),
        at(32),
      ),
    );
    expect(unwrapErr(CouponGrantSystem.restore(expired, issued))).toEqual({
      code: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantState.Expired,
    });
  });

  it('restore ∘ burn is the identity on any grant with a use left (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        (total, spent) => {
          fc.pre(spent < total);
          const issued: GrantTerms = {
            capacity: multiUse(total),
            expiration: CouponGrantExpiration.none(),
          };
          let grant = makeActiveGrant(issued.capacity);
          for (let i = 0; i < spent; i++) {
            grant = unwrapOk(CouponGrantSystem.burn(grant, at(i), ''));
          }
          const burnt = unwrapOk(CouponGrantSystem.burn(grant, at(9), ''));
          const back = unwrapOk(CouponGrantSystem.restore(burnt, issued));
          if (spent + 1 === total) {
            // A spent multi-use comes back with exactly one use.
            expect(back.state).toEqual(
              GrantStatus.active(
                {
                  kind: GrantCapacityKind.MultiUse,
                  remaining: 1,
                  totalGranted: total,
                },
                CouponGrantExpiration.none(),
              ),
            );
          } else {
            expect(back).toEqual(grant);
          }
        },
      ),
    );
  });
});

describe('CouponGrantSystem.isOccasion', () => {
  it('reads the coupon’s own tag — never a name', () => {
    expect(
      CouponGrantSystem.isOccasion(
        CouponOccasion.Birthday,
        CouponOccasion.Birthday,
      ),
    ).toBe(true);
    expect(CouponGrantSystem.isOccasion(null, CouponOccasion.Birthday)).toBe(
      false,
    );
  });
});

describe('CouponGrantSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const grant = deepFreeze(makeActiveGrant(multiUse(2)));
    const once = CouponGrantSystem.burn(grant, at(1), 'x');
    const twice = CouponGrantSystem.burn(grant, at(1), 'x');
    expect(twice).toEqual(once);
    expect(grant.state).toEqual(
      GrantStatus.active(multiUse(2), CouponGrantExpiration.none()),
    );
  });
});
