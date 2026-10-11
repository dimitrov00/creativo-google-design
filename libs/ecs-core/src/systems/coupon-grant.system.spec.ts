import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CouponOccasion } from '../components/coupon-occasion.data';
import { CouponValue } from '../components/coupon-value.data';
import { EngagementErrorCode } from '../components/engagement-errors.data';
import {
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  GrantStatus,
  type GrantTerms,
} from '../components/grant-status.data';
import type { CouponGrant } from '../entities/coupon-grant.entity';
import { CouponGrantId, CouponId, UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { deepFreeze, unwrapErr, unwrapOk, utcMs } from '../testing';
import { CouponGrantSystem } from './coupon-grant.system';

/*
 * The cases of libs/domain/engagement/src/lib/coupon-grant.spec.ts, copied
 * over plain flat entities (the class spec keeps running against its shim):
 * `markUsed` is `burn`, instants are `UtcEpochMs`. Plus the inverse the visit
 * editor's undo needs (`restore`), as an exact-inverse property.
 */

const JAN_1 = utcMs('2026-01-01T00:00:00+02:00');
const DAY = 86_400_000;
const at = (days: number): UtcEpochMs => UtcEpochMs.plusMs(JAN_1, days * DAY);

function makeActiveGrant(
  capacity: GrantCapacityTerms,
  expiry: GrantExpiryTerms = GrantExpiryTerms.none(),
): CouponGrant {
  return {
    id: CouponGrantId.of('grant-1'),
    userId: UserId.of('user-1'),
    couponId: CouponId.of('coupon-1'),
    grantedAtUtcMs: JAN_1,
    ...unwrapOk(CouponValue.percentOff(10)),
    ...GrantLifecycle.active(capacity, expiry),
  };
}

function multiUse(total: number): GrantCapacityTerms {
  return unwrapOk(GrantCapacityTerms.multiUse(total));
}

function terms(
  capacity: GrantCapacityTerms,
  expiry: GrantExpiryTerms,
): GrantTerms {
  return { ...capacity, ...expiry };
}

describe('CouponGrantSystem — a fresh grant', () => {
  it('creates an active grant', () => {
    expect(
      CouponGrantSystem.isActive(
        makeActiveGrant(GrantCapacityTerms.singleUse()),
      ),
    ).toBe(true);
  });

  it('GrantCapacityTerms.multiUse rejects a non-positive total', () => {
    expect(GrantCapacityTerms.multiUse(0).ok).toBe(false);
  });
});

describe('CouponGrantSystem.burn', () => {
  it('single-use transitions straight to used, leaving no active field behind', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(GrantLifecycle.of(used)).toEqual({
      grantStatus: GrantStatus.Used,
      usedAtUtcMs: at(1),
      usedNote: '',
    });
    expect('grantCapacity' in used).toBe(false);
    expect(CouponValue.of(used)).toEqual(unwrapOk(CouponValue.percentOff(10)));
  });

  it('multi-use decrements remaining and stays active until exhausted', () => {
    const grant = makeActiveGrant(multiUse(2));
    const first = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(first.grantStatus).toBe('ACTIVE');
    const second = unwrapOk(CouponGrantSystem.burn(first, at(2), 'appt-1'));
    expect(GrantLifecycle.of(second)).toEqual({
      grantStatus: GrantStatus.Used,
      usedAtUtcMs: at(2),
      usedNote: 'appt-1',
    });
  });

  it('rejects marking an already-used grant as used again', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(GrantCapacityTerms.singleUse()),
        at(1),
        '',
      ),
    );
    expect(unwrapErr(CouponGrantSystem.burn(used, at(2), ''))).toEqual({
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantStatus.Used,
    });
  });
});

describe('CouponGrantSystem.expire', () => {
  it('expires a grant with a scheduled expiry', () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    const expired = unwrapOk(CouponGrantSystem.expire(grant, at(32)));
    expect(GrantLifecycle.of(expired)).toEqual({
      grantStatus: GrantStatus.Expired,
      expiredAtUtcMs: at(32),
      expiryScheduledAtUtcMs: at(31),
    });
  });

  it('rejects expiring a grant with no scheduled expiry', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    expect(unwrapErr(CouponGrantSystem.expire(grant, at(32))).errorCode).toBe(
      EngagementErrorCode.CouponGrantNotExpiring,
    );
  });
});

describe('CouponGrantSystem.revoke', () => {
  it('revokes an active grant with a reason', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    const revoked = unwrapOk(
      CouponGrantSystem.revoke(grant, at(4), UserId.of('admin'), '  fraud '),
    );
    expect(GrantLifecycle.of(revoked)).toEqual({
      grantStatus: GrantStatus.Revoked,
      revokedAtUtcMs: at(4),
      revokedByUserId: 'admin',
      revocationReason: 'fraud',
    });
  });

  it('rejects an empty revocation reason', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    expect(
      unwrapErr(CouponGrantSystem.revoke(grant, at(4), UserId.of('a'), '  '))
        .errorCode,
    ).toBe(EngagementErrorCode.CouponGrantReasonEmpty);
  });

  it('rejects revoking a non-active grant', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(GrantCapacityTerms.singleUse()),
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
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    expect(CouponGrantSystem.isUsable(grant, at(14))).toBe(true);
    expect(CouponGrantSystem.isUsable(grant, at(31))).toBe(true);
    expect(CouponGrantSystem.isUsable(grant, at(59))).toBe(false);
  });

  it('is never usable once used', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        makeActiveGrant(GrantCapacityTerms.singleUse()),
        at(1),
        '',
      ),
    );
    expect(CouponGrantSystem.isUsable(used, at(2))).toBe(false);
  });
});

describe('CouponGrantSystem.restore — the exact inverse of a burn', () => {
  it('brings a spent grant back as it was issued, one use on it', () => {
    const issued = terms(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    const grant = makeActiveGrant(issued, issued);
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(unwrapOk(CouponGrantSystem.restore(used, issued))).toEqual(grant);
    if (grant.grantStatus !== GrantStatus.Active) throw new Error('fixture');
    expect(CouponGrantSystem.termsOf(grant)).toEqual(issued);
  });

  it('gives a multi-use grant its use back, up to what was granted', () => {
    const issued = terms(multiUse(3), GrantExpiryTerms.none());
    const grant = makeActiveGrant(issued);
    expect(unwrapErr(CouponGrantSystem.restore(grant, issued))).toEqual({
      errorCode: EngagementErrorCode.CouponGrantCapacityInvalid,
      attempted: 4,
    });
    expect(
      unwrapErr(
        CouponGrantSystem.restore(
          makeActiveGrant(GrantCapacityTerms.singleUse()),
          issued,
        ),
      ).errorCode,
    ).toBe(EngagementErrorCode.CouponGrantCapacityInvalid);
  });

  it('refuses an expired or revoked grant', () => {
    const issued = terms(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    const expired = unwrapOk(
      CouponGrantSystem.expire(makeActiveGrant(issued, issued), at(32)),
    );
    expect(unwrapErr(CouponGrantSystem.restore(expired, issued))).toEqual({
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantStatus.Expired,
    });
  });

  it('restore ∘ burn is the identity on any grant with a use left (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        (total, spent) => {
          fc.pre(spent < total);
          const issued = terms(multiUse(total), GrantExpiryTerms.none());
          let grant = makeActiveGrant(issued);
          for (let i = 0; i < spent; i++) {
            grant = unwrapOk(CouponGrantSystem.burn(grant, at(i), ''));
          }
          const burnt = unwrapOk(CouponGrantSystem.burn(grant, at(9), ''));
          const back = unwrapOk(CouponGrantSystem.restore(burnt, issued));
          if (spent + 1 === total) {
            // A spent multi-use comes back with exactly one use.
            expect(GrantLifecycle.of(back)).toEqual(
              GrantLifecycle.active(
                {
                  grantCapacity: GrantCapacity.MultiUse,
                  usesRemaining: 1,
                  usesGranted: total,
                },
                GrantExpiryTerms.none(),
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

describe('CouponGrantSystem.transitionWrite — one variant on the stored document', () => {
  it('sets the used variant and deletes the active terms', () => {
    const grant = makeActiveGrant(multiUse(1), GrantExpiryTerms.at(at(31)));
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), 'appt-1'));
    expect(CouponGrantSystem.transitionWrite(grant, used)).toMatchObject({
      writeAction: 'UPDATE',
      path: ['couponGrants', 'grant-1'],
      fields: {
        grantStatus: 'USED',
        usedAtUtcMs: at(1),
        usedNote: 'appt-1',
      },
      deleteFields: [
        'grantCapacity',
        'usesRemaining',
        'usesGranted',
        'grantExpiry',
        'grantExpiresAtUtcMs',
      ],
    });
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
    expect(GrantLifecycle.of(grant)).toEqual(
      GrantLifecycle.active(multiUse(2), GrantExpiryTerms.none()),
    );
  });
});
