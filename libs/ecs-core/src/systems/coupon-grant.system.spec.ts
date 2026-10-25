import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
} from '@core/components';
import {
  GrantStatus,
  CouponGrantId,
  CouponId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementErrorCode } from '@core/errors';
import type { Coupon, CouponGrant } from '@core/entities';
import {
  deepFreeze,
  unwrapErr,
  unwrapOk,
  utcMs,
  customerOf,
} from '@core/testing';
import { CouponGrantSystem } from './coupon-grant.system';

/*
 * The cases of the legacy engagement `coupon-grant.spec.ts` (deleted in Phase
 * 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), copied over
 * plain flat entities: `markUsed` is `burn`, instants are `UtcEpochMs`. Plus
 * the inverse the visit editor's undo needs (`restore`), as an exact-inverse
 * property.
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
    customerId: customerOf(UserId.of('user-1')),
    holderUserId: UserId.of('user-1'),
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
): GrantLifecycle.Terms {
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
    // Whose it is rides every transition: the record and the reading account (D29).
    expect(used.customerId).toBe(grant.customerId);
    expect(used.holderUserId).toBe(grant.holderUserId);
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

/*
 * The birthday card's partition of the grants (Law 10.2; glance.presenter
 * `birthdayVm`/`grantsBesideBirthday`, glance.presenter.spec.ts «carries
 * the gift under the band», «never reads a name», «takes the gift out of
 * the reward ticket’s grants while the card carries it, and only then»).
 * A card grant may leave its occasion out (`ClientCardGrant.couponOccasion`
 * is optional): absent reads as none.
 */
type CardGrant = {
  readonly grantId: string;
  readonly title: string;
  readonly couponOccasion?: CouponOccasion | null;
};

const GEORGI_GRANT: CardGrant = {
  grantId: 'grant-dev-georgi-1',
  title: 'Безплатна брада',
};
const BIRTHDAY_GRANT: CardGrant = {
  grantId: 'grant-dev-martin-birthday',
  title: 'Рожден ден',
  couponOccasion: CouponOccasion.Birthday,
};
/** A grant titled «Рожден ден» whose host states no occasion — never a gift. */
const NAMED_ONLY: CardGrant = {
  grantId: 'grant-named',
  title: 'Рожден ден',
  couponOccasion: null,
};

describe('CouponGrantSystem.forOccasion — the gift is picked from these', () => {
  it('keeps only the grants whose coupon was made for the occasion, in order', () => {
    expect(
      CouponGrantSystem.forOccasion(
        [GEORGI_GRANT, BIRTHDAY_GRANT],
        CouponOccasion.Birthday,
      ),
    ).toEqual([BIRTHDAY_GRANT]);
  });

  it('never reads a name: an absent or null occasion is none', () => {
    expect(
      CouponGrantSystem.forOccasion(
        [NAMED_ONLY, GEORGI_GRANT],
        CouponOccasion.Birthday,
      ),
    ).toEqual([]);
    expect(CouponGrantSystem.forOccasion([], CouponOccasion.Birthday)).toEqual(
      [],
    );
  });
});

describe('CouponGrantSystem.besideOccasionGift — the ticket never repeats the gift', () => {
  const held = [GEORGI_GRANT, BIRTHDAY_GRANT];

  it('takes the occasion’s grants out while the card carries the gift', () => {
    expect(
      CouponGrantSystem.besideOccasionGift(held, CouponOccasion.Birthday, true),
    ).toEqual([GEORGI_GRANT]);
    // A grant with no occasion stays a ticket.
    expect(
      CouponGrantSystem.besideOccasionGift(
        [NAMED_ONLY, BIRTHDAY_GRANT],
        CouponOccasion.Birthday,
        true,
      ),
    ).toEqual([NAMED_ONLY]);
  });

  it('takes nothing out otherwise — the band alone, any other day — and hands the same list back', () => {
    const kept = CouponGrantSystem.besideOccasionGift(
      held,
      CouponOccasion.Birthday,
      false,
    );
    expect(kept).toEqual(held);
    expect(kept).toBe(held);
  });

  it('is the exact complement of forOccasion while the gift is carried', () => {
    const grants = [GEORGI_GRANT, BIRTHDAY_GRANT, NAMED_ONLY, BIRTHDAY_GRANT];
    const gift = CouponGrantSystem.forOccasion(grants, CouponOccasion.Birthday);
    const beside = CouponGrantSystem.besideOccasionGift(
      grants,
      CouponOccasion.Birthday,
      true,
    );
    expect(gift.length + beside.length).toBe(grants.length);
    expect(beside).toEqual([GEORGI_GRANT, NAMED_ONLY]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const grants = deepFreeze([GEORGI_GRANT, BIRTHDAY_GRANT, NAMED_ONLY]);
    const run = () => ({
      gift: CouponGrantSystem.forOccasion(grants, CouponOccasion.Birthday),
      beside: CouponGrantSystem.besideOccasionGift(
        grants,
        CouponOccasion.Birthday,
        true,
      ),
    });
    expect(run()).toEqual(run());
    expect(grants).toEqual([GEORGI_GRANT, BIRTHDAY_GRANT, NAMED_ONLY]);
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

/* ── Pass C: the held grant's lapse, the settle's resolver, the menu's join ── */

function couponOf(
  id: string,
  name: string,
  combinability: Combinability = Combinability.Stackable,
  couponStatus: CouponStatus = CouponStatus.Enabled,
): Coupon {
  return {
    id: CouponId.of(id),
    name,
    code: null,
    combinability,
    usageLimit: null,
    couponStatus,
    couponOccasion: null,
    ...unwrapOk(CouponValue.percentOff(25)),
    ...CouponExpiryRule.never(),
  };
}

function grantOf(id: string, couponId: string): CouponGrant {
  return {
    ...makeActiveGrant(GrantCapacityTerms.singleUse()),
    id: CouponGrantId.of(id),
    couponId: CouponId.of(couponId),
  };
}

describe('CouponGrantSystem.expiresAtUtcMs — when a held grant lapses', () => {
  it('names the instant of an ACTIVE grant with an EXPIRES_AT expiry, and nothing for every other lifecycle', () => {
    const lapsing = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(30)),
    );
    expect(CouponGrantSystem.expiresAtUtcMs(lapsing)).toBe(at(30));
    expect(
      CouponGrantSystem.expiresAtUtcMs(
        makeActiveGrant(GrantCapacityTerms.singleUse()),
      ),
    ).toBeNull();
    expect(
      CouponGrantSystem.expiresAtUtcMs(GrantLifecycle.used(at(2), '')),
    ).toBeNull();
    expect(
      CouponGrantSystem.expiresAtUtcMs(GrantLifecycle.expired(at(31), at(30))),
    ).toBeNull();
    expect(
      CouponGrantSystem.expiresAtUtcMs(
        GrantLifecycle.revoked(at(3), UserId.of('admin'), 'грешка'),
      ),
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const grant = deepFreeze(
      makeActiveGrant(multiUse(2), GrantExpiryTerms.at(at(5))),
    );
    expect(CouponGrantSystem.expiresAtUtcMs(grant)).toEqual(
      CouponGrantSystem.expiresAtUtcMs(grant),
    );
  });
});

describe('CouponGrantSystem.resolved — a grant as the bill settle reads it', () => {
  it("labels it with its coupon's name and reads the coupon's own rule; the value stays the grant's snapshot", () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(10)),
    );
    const coupon = couponOf('coupon-1', 'Рожден ден', Combinability.Exclusive);
    expect(CouponGrantSystem.resolved(grant, coupon, at(1))).toEqual({
      grantId: 'grant-1',
      customerId: grant.customerId,
      label: 'Рожден ден',
      usable: true,
      exclusive: true,
      discountMethod: 'PERCENT_OFF',
      discountPercent: 10,
    });
  });

  it('is usable AT the expiry instant, and not a moment after', () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(10)),
    );
    const coupon = couponOf('coupon-1', 'Рожден ден');
    expect(CouponGrantSystem.resolved(grant, coupon, at(10)).usable).toBe(true);
    expect(
      CouponGrantSystem.resolved(grant, coupon, UtcEpochMs.plusMs(at(10), 1))
        .usable,
    ).toBe(false);
  });

  it('labels a grant whose coupon is gone or nameless by its coupon id, else its own id — and reads it as stackable', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    const gone = CouponGrantSystem.resolved(grant, null, at(1));
    expect(gone.label).toBe('coupon-1');
    expect(gone.exclusive).toBe(false);
    const blank = couponOf('coupon-1', '   ', Combinability.Exclusive);
    expect(CouponGrantSystem.resolved(grant, blank, at(1))).toMatchObject({
      label: 'coupon-1',
      exclusive: true,
    });
    const orphan: CouponGrant = { ...grant, couponId: CouponId.of('') };
    expect(CouponGrantSystem.resolved(orphan, null, at(1)).label).toBe(
      'grant-1',
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const grant = deepFreeze(makeActiveGrant(multiUse(3)));
    const coupon = deepFreeze(couponOf('coupon-1', 'Постоянен клиент'));
    expect(CouponGrantSystem.resolved(grant, coupon, at(1))).toEqual(
      CouponGrantSystem.resolved(grant, coupon, at(1)),
    );
  });
});

describe('CouponGrantSystem.held — the grants joined to their coupons', () => {
  it("keeps the grants' order, keeps a disabled coupon's grant, and leaves out a grant whose coupon is gone", () => {
    const loyal = couponOf('coupon-loyal', 'Постоянен клиент');
    const disabled = couponOf(
      'coupon-old',
      'Стара промоция',
      Combinability.Stackable,
      CouponStatus.Disabled,
    );
    const grants = [
      grantOf('grant-old', 'coupon-old'),
      grantOf('grant-gone', 'coupon-gone'),
      grantOf('grant-loyal', 'coupon-loyal'),
    ];
    const held = CouponGrantSystem.held(grants, [loyal, disabled]);
    expect(held.map((row) => [row.grant.id, row.coupon.id])).toEqual([
      ['grant-old', 'coupon-old'],
      ['grant-loyal', 'coupon-loyal'],
    ]);
    expect(held[0]?.coupon).toBe(disabled);
    expect(CouponGrantSystem.held([], [loyal])).toEqual([]);
    expect(CouponGrantSystem.held(grants, [])).toEqual([]);
  });

  it('answers two coupons of one id with the later one', () => {
    const first = couponOf('coupon-1', 'Първо');
    const later = couponOf('coupon-1', 'Второ');
    expect(
      CouponGrantSystem.held(
        [grantOf('grant-1', 'coupon-1')],
        [first, later],
      )[0]?.coupon.name,
    ).toBe('Второ');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const grants = deepFreeze([
      grantOf('grant-a', 'coupon-a'),
      grantOf('grant-b', 'coupon-b'),
    ]);
    const coupons = deepFreeze([couponOf('coupon-b', 'Б')]);
    expect(CouponGrantSystem.held(grants, coupons)).toEqual(
      CouponGrantSystem.held(grants, coupons),
    );
    expect(grants.map((grant) => grant.id)).toEqual(['grant-a', 'grant-b']);
  });
});
