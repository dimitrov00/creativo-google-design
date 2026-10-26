import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  DiscountProvenance,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  WriteOp,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
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
 * the inverse a give-back needs (`restore`), as an exact-inverse property,
 * and the bill's grant writes (OR-13: `settleBill`, `releasePlan`). The
 * expire and revoke verbs are deleted with their cases (OR-13: no expiry
 * job or admin revoke is built).
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

/** The fixture grant moved to `lifecycle` — its meta and value as they were. */
function grantIn(lifecycle: GrantLifecycle): CouponGrant {
  const { id, customerId, holderUserId, couponId, grantedAtUtcMs } =
    makeActiveGrant(GrantCapacityTerms.singleUse());
  return {
    id,
    customerId,
    holderUserId,
    couponId,
    grantedAtUtcMs,
    ...unwrapOk(CouponValue.percentOff(10)),
    ...lifecycle,
  };
}

describe('CouponGrantSystem — a fresh grant', () => {
  it('creates an active, usable grant', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    expect(grant.grantStatus).toBe(GrantStatus.Active);
    expect(CouponGrantSystem.isUsable(grant, at(0))).toBe(true);
  });

  it('GrantCapacityTerms.multiUse rejects a non-positive total', () => {
    expect(GrantCapacityTerms.multiUse(0).ok).toBe(false);
  });
});

describe('CouponGrantSystem.burn', () => {
  it('single-use transitions straight to used, the issue terms kept (OR-13)', () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(GrantLifecycle.of(used)).toEqual({
      grantStatus: GrantStatus.Used,
      grantCapacity: GrantCapacity.SingleUse,
      grantExpiry: 'EXPIRES_AT',
      grantExpiresAtUtcMs: at(31),
      usedAtUtcMs: at(1),
      usedNote: '',
    });
    expect(CouponValue.of(used)).toEqual(unwrapOk(CouponValue.percentOff(10)));
    // Whose it is rides every transition: the record and the reading account (D29).
    expect(used.customerId).toBe(grant.customerId);
    expect(used.holderUserId).toBe(grant.holderUserId);
  });

  it('multi-use decrements remaining and stays active until exhausted — then USED with no use remaining', () => {
    const grant = makeActiveGrant(multiUse(2));
    const first = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(GrantLifecycle.of(first)).toEqual(
      GrantLifecycle.active(
        {
          grantCapacity: GrantCapacity.MultiUse,
          usesRemaining: 1,
          usesGranted: 2,
        },
        GrantExpiryTerms.none(),
      ),
    );
    const second = unwrapOk(CouponGrantSystem.burn(first, at(2), 'appt-1'));
    expect(GrantLifecycle.of(second)).toEqual({
      grantStatus: GrantStatus.Used,
      grantCapacity: GrantCapacity.MultiUse,
      usesRemaining: 0,
      usesGranted: 2,
      grantExpiry: 'NO_EXPIRY',
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
  it('brings a spent grant back as it was issued, one use on it — from its own kept terms', () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(31)),
    );
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), ''));
    expect(unwrapOk(CouponGrantSystem.restore(used))).toEqual(grant);
  });

  it('gives a spent multi-use grant exactly one use back', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(makeActiveGrant(multiUse(1)), at(1), ''),
    );
    expect(
      GrantLifecycle.of(unwrapOk(CouponGrantSystem.restore(used))),
    ).toEqual(
      GrantLifecycle.active(
        {
          grantCapacity: GrantCapacity.MultiUse,
          usesRemaining: 1,
          usesGranted: 1,
        },
        GrantExpiryTerms.none(),
      ),
    );
  });

  it('restores a spent grant past its expiry to ACTIVE — and it is not usable', () => {
    const grant = makeActiveGrant(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(10)),
    );
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(9), ''));
    const back = unwrapOk(CouponGrantSystem.restore(used));
    expect(back.grantStatus).toBe(GrantStatus.Active);
    expect(CouponGrantSystem.isUsable(back, at(11))).toBe(false);
    expect(CouponGrantSystem.isUsable(back, at(10))).toBe(true);
  });

  it('gives a multi-use grant its use back, up to what was granted', () => {
    const grant = makeActiveGrant(multiUse(3));
    expect(unwrapErr(CouponGrantSystem.restore(grant))).toEqual({
      errorCode: EngagementErrorCode.CouponGrantCapacityInvalid,
      attempted: 4,
    });
    expect(
      unwrapErr(
        CouponGrantSystem.restore(
          makeActiveGrant(GrantCapacityTerms.singleUse()),
        ),
      ),
    ).toEqual({
      errorCode: EngagementErrorCode.CouponGrantCapacityInvalid,
      attempted: 2,
    });
  });

  it('refuses an expired or revoked grant', () => {
    expect(
      unwrapErr(
        CouponGrantSystem.restore(
          grantIn(GrantLifecycle.expired(at(32), at(31))),
        ),
      ),
    ).toEqual({
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantStatus.Expired,
    });
    expect(
      unwrapErr(
        CouponGrantSystem.restore(
          grantIn(GrantLifecycle.revoked(at(4), UserId.of('admin'), 'fraud')),
        ),
      ),
    ).toEqual({
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantStatus.Revoked,
    });
  });

  it('restore ∘ burn is the identity on any grant with a use left (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        (total, spent, expiring) => {
          fc.pre(spent < total);
          let grant = makeActiveGrant(
            multiUse(total),
            expiring ? GrantExpiryTerms.at(at(30)) : GrantExpiryTerms.none(),
          );
          for (let i = 0; i < spent; i++) {
            grant = unwrapOk(CouponGrantSystem.burn(grant, at(i), ''));
          }
          const burnt = unwrapOk(CouponGrantSystem.burn(grant, at(9), ''));
          // The last use spent included: the USED grant kept its terms.
          expect(unwrapOk(CouponGrantSystem.restore(burnt))).toEqual(grant);
        },
      ),
    );
  });
});

describe('CouponGrantSystem.transitionWrite — one variant on the stored document', () => {
  it('sets the used variant over the kept terms, and deletes nothing', () => {
    const grant = makeActiveGrant(multiUse(1), GrantExpiryTerms.at(at(31)));
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), 'appt-1'));
    expect(CouponGrantSystem.transitionWrite(grant, used)).toEqual({
      writeAction: 'UPDATE',
      path: ['couponGrants', 'grant-1'],
      fields: {
        grantStatus: 'USED',
        grantCapacity: 'MULTI_USE',
        usesRemaining: 0,
        usesGranted: 1,
        grantExpiry: 'EXPIRES_AT',
        grantExpiresAtUtcMs: at(31),
        usedAtUtcMs: at(1),
        usedNote: 'appt-1',
      },
      deleteFields: [],
    });
  });

  it('a restore sets the active variant and deletes the redemption', () => {
    const grant = makeActiveGrant(GrantCapacityTerms.singleUse());
    const used = unwrapOk(CouponGrantSystem.burn(grant, at(1), 'appt-1'));
    const back = unwrapOk(CouponGrantSystem.restore(used));
    expect(CouponGrantSystem.transitionWrite(used, back)).toEqual({
      writeAction: 'UPDATE',
      path: ['couponGrants', 'grant-1'],
      fields: {
        grantStatus: 'ACTIVE',
        grantCapacity: 'SINGLE_USE',
        grantExpiry: 'NO_EXPIRY',
      },
      deleteFields: ['usedAtUtcMs', 'usedNote'],
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
 * A card grant always states its occasion (OR-16: required) — `null` is
 * none.
 */
type CardGrant = {
  readonly grantId: string;
  readonly title: string;
  readonly couponOccasion: CouponOccasion | null;
};

const GEORGI_GRANT: CardGrant = {
  grantId: 'grant-dev-georgi-1',
  title: 'Безплатна брада',
  couponOccasion: null,
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

  it('never reads a name: a null occasion is none', () => {
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
      CouponGrantSystem.expiresAtUtcMs(
        GrantLifecycle.used(
          { ...GrantCapacityTerms.singleUse(), ...GrantExpiryTerms.at(at(30)) },
          at(2),
          '',
        ),
      ),
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

describe('CouponGrantSystem.offered — the grants the «Отстъпка» menu offers (OR-13)', () => {
  const expiring = (id: string): CouponGrant => ({
    ...grantOf(id, 'coupon-1'),
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.at(at(1)),
    ),
  });
  const spent = (id: string): CouponGrant => ({
    ...grantOf(id, 'coupon-1'),
    ...GrantLifecycle.used(
      { ...GrantCapacityTerms.singleUse(), ...GrantExpiryTerms.none() },
      at(1),
      'appointment:a-1',
    ),
  });

  it('offers the usable held grants in their order, then each bill grant whatever its status, in bill order, once', () => {
    const fresh = grantOf('grant-fresh', 'coupon-1');
    const lapsed = expiring('grant-lapsed');
    const burned = spent('grant-burned');
    const offered = CouponGrantSystem.offered(
      [lapsed, fresh],
      [burned],
      [
        CouponGrantId.of('grant-burned'),
        CouponGrantId.of('grant-fresh'),
        CouponGrantId.of('grant-lapsed'),
        CouponGrantId.of('grant-unknown'),
      ],
      at(2),
    );
    // The lapsed one is no NEW promise — it shows only as the bill's own.
    expect(offered.map((grant) => grant.id)).toEqual([
      'grant-fresh',
      'grant-burned',
      'grant-lapsed',
    ]);
  });

  it('offers nothing for a bill id neither answer names, and nothing at all from nothing', () => {
    expect(
      CouponGrantSystem.offered([], [], [CouponGrantId.of('gone')], at(0)),
    ).toEqual([]);
    expect(CouponGrantSystem.offered([], [], [], at(0))).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const held = deepFreeze([grantOf('grant-a', 'coupon-1')]);
    const billed = deepFreeze([spent('grant-b')]);
    const ids = deepFreeze([CouponGrantId.of('grant-b')]);
    const once = CouponGrantSystem.offered(held, billed, ids, at(0));
    expect(CouponGrantSystem.offered(held, billed, ids, at(0))).toEqual(once);
    expect(held.map((grant) => grant.id)).toEqual(['grant-a']);
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

/* ── OR-13: the bill burns a grant at save and gives it back ───────────── */

const APPOINTMENT = AppointmentId.of('appt-7');

/** A grant line on a bill, as the settle stores it — a whole discount passes. */
function grantLine(grantId: string): AppliedDiscount {
  return {
    discountId: AppliedDiscountId.of(`grant:${grantId}`),
    label: 'Рожден ден',
    appliedAtUtcMs: at(0),
    combinability: Combinability.Stackable,
    ...DiscountProvenance.grant(CouponGrantId.of(grantId)),
    ...unwrapOk(CouponValue.percentOff(10)),
  };
}

const MANUAL_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of('manual'),
  label: 'manual',
  appliedAtUtcMs: at(0),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.manual(),
  ...unwrapOk(CouponValue.percentOff(5)),
};

/** Grant `id`, fresh: single-use unless `capacity` says otherwise. */
function freshGrant(
  id: string,
  capacity: GrantCapacityTerms = GrantCapacityTerms.singleUse(),
): CouponGrant {
  return { ...makeActiveGrant(capacity), id: CouponGrantId.of(id) };
}

describe('CouponGrantSystem.settleBill — a saved bill’s grant writes', () => {
  it('burns a grant line new on the bill, noted with the visit', () => {
    const grant = freshGrant('grant-1');
    const writes = unwrapOk(
      CouponGrantSystem.settleBill(
        [MANUAL_LINE],
        [MANUAL_LINE, grantLine('grant-1')],
        [grant],
        APPOINTMENT,
        at(2),
      ),
    );
    const used = unwrapOk(
      CouponGrantSystem.burn(grant, at(2), 'appointment:appt-7'),
    );
    expect(writes).toEqual([CouponGrantSystem.transitionWrite(grant, used)]);
    expect(writes[0]).toMatchObject({
      fields: {
        grantStatus: 'USED',
        grantCapacity: 'SINGLE_USE',
        usedAtUtcMs: at(2),
        usedNote: 'appointment:appt-7',
      },
    });
  });

  it('counts a multi-use grant down by one, and to USED on its last use', () => {
    const three = freshGrant('grant-3', multiUse(3));
    const [down] = unwrapOk(
      CouponGrantSystem.settleBill(
        [],
        [grantLine('grant-3')],
        [three],
        APPOINTMENT,
        at(2),
      ),
    );
    expect(down).toMatchObject({
      fields: { grantStatus: 'ACTIVE', usesRemaining: 2, usesGranted: 3 },
    });
    const last = freshGrant('grant-1x', multiUse(1));
    const [spent] = unwrapOk(
      CouponGrantSystem.settleBill(
        [],
        [grantLine('grant-1x')],
        [last],
        APPOINTMENT,
        at(2),
      ),
    );
    expect(spent).toMatchObject({
      fields: { grantStatus: 'USED', usesRemaining: 0, usesGranted: 1 },
    });
  });

  it('restores a grant line that left the bill', () => {
    const grant = freshGrant('grant-1');
    const used = unwrapOk(
      CouponGrantSystem.burn(grant, at(1), 'appointment:appt-7'),
    );
    expect(
      unwrapOk(
        CouponGrantSystem.settleBill(
          [grantLine('grant-1'), MANUAL_LINE],
          [MANUAL_LINE],
          [used],
          APPOINTMENT,
          at(2),
        ),
      ),
    ).toEqual([CouponGrantSystem.transitionWrite(used, grant)]);
  });

  it('writes nothing for a kept line — a replay of the same bill writes nothing', () => {
    const used = unwrapOk(
      CouponGrantSystem.burn(
        freshGrant('grant-1'),
        at(1),
        'appointment:appt-7',
      ),
    );
    const bill = [grantLine('grant-1'), MANUAL_LINE];
    expect(
      unwrapOk(
        CouponGrantSystem.settleBill(bill, bill, [used], APPOINTMENT, at(2)),
      ),
    ).toEqual([]);
    expect(
      unwrapOk(CouponGrantSystem.settleBill([], [], [], APPOINTMENT, at(2))),
    ).toEqual([]);
  });

  it('burns the new, restores the gone and leaves the kept in one pass', () => {
    const kept = unwrapOk(
      CouponGrantSystem.burn(freshGrant('grant-kept'), at(1), 'x'),
    );
    const gone = unwrapOk(
      CouponGrantSystem.burn(freshGrant('grant-gone'), at(1), 'x'),
    );
    const added = freshGrant('grant-new');
    const writes = unwrapOk(
      CouponGrantSystem.settleBill(
        [grantLine('grant-kept'), grantLine('grant-gone')],
        [grantLine('grant-kept'), grantLine('grant-new')],
        [kept, gone, added],
        APPOINTMENT,
        at(2),
      ),
    );
    expect(writes.map((write) => write.path)).toEqual([
      ['couponGrants', 'grant-new'],
      ['couponGrants', 'grant-gone'],
    ]);
  });

  it('reads a grant the batch and the stored bill both named once — the first copy answers', () => {
    const grant = freshGrant('grant-1');
    const writes = unwrapOk(
      CouponGrantSystem.settleBill(
        [],
        [grantLine('grant-1')],
        [grant, { ...grant, couponId: CouponId.of('coupon-copy') }],
        APPOINTMENT,
        at(2),
      ),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toEqual(['couponGrants', 'grant-1']);
  });

  it('refuses the save when a new line names a grant that will not burn — the second visit of a single-use grant', () => {
    const spent = unwrapOk(
      CouponGrantSystem.burn(
        freshGrant('grant-1'),
        at(1),
        'appointment:appt-1',
      ),
    );
    expect(
      unwrapErr(
        CouponGrantSystem.settleBill(
          [],
          [grantLine('grant-1')],
          [spent],
          APPOINTMENT,
          at(2),
        ),
      ),
    ).toEqual({
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState: GrantStatus.Used,
    });
  });

  it('skips a restore the grant refuses, and a line whose grant was not read — the save still lands', () => {
    const expired = {
      ...grantIn(GrantLifecycle.expired(at(5), at(4))),
      id: CouponGrantId.of('grant-old'),
    };
    const untouched = freshGrant('grant-full');
    expect(
      unwrapOk(
        CouponGrantSystem.settleBill(
          [grantLine('grant-old'), grantLine('grant-full')],
          [grantLine('grant-unread')],
          [expired, untouched],
          APPOINTMENT,
          at(2),
        ),
      ),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze([grantLine('grant-gone'), MANUAL_LINE]);
    const after = deepFreeze([grantLine('grant-new')]);
    const grants = deepFreeze([
      freshGrant('grant-new'),
      unwrapOk(CouponGrantSystem.burn(freshGrant('grant-gone'), at(1), 'x')),
    ]);
    const run = () =>
      CouponGrantSystem.settleBill(before, after, grants, APPOINTMENT, at(2));
    expect(run()).toEqual(run());
    expect(grants[0]?.grantStatus).toBe(GrantStatus.Active);
    expect(before).toHaveLength(2);
  });
});

describe('CouponGrantSystem.releasePlan — a cancel or a no-show gives the grants back', () => {
  it('drops every grant line, keeps the rest in order, and restores each grant', () => {
    const grant = freshGrant('grant-1');
    const used = unwrapOk(
      CouponGrantSystem.burn(grant, at(1), 'appointment:appt-7'),
    );
    const plan = CouponGrantSystem.releasePlan(
      [grantLine('grant-1'), MANUAL_LINE],
      [used],
    );
    expect(plan.discounts).toEqual([MANUAL_LINE]);
    expect(plan.writes).toEqual([
      CouponGrantSystem.transitionWrite(used, grant),
    ]);
    expect(WriteOp.isDelete(plan.writes[0] as WriteOp)).toBe(false);
  });

  it('hands the same discounts back, and writes nothing, when the bill holds no grant line', () => {
    const discounts = [MANUAL_LINE];
    const plan = CouponGrantSystem.releasePlan(discounts, []);
    expect(plan.discounts).toBe(discounts);
    expect(plan.writes).toEqual([]);
    expect(CouponGrantSystem.releasePlan([], []).discounts).toEqual([]);
  });

  it('drops the line of a grant it cannot give back, and writes nothing for it', () => {
    const revoked = {
      ...grantIn(GrantLifecycle.revoked(at(3), UserId.of('admin'), 'грешка')),
      id: CouponGrantId.of('grant-revoked'),
    };
    const plan = CouponGrantSystem.releasePlan(
      [grantLine('grant-revoked'), grantLine('grant-unread'), MANUAL_LINE],
      [revoked],
    );
    expect(plan.discounts).toEqual([MANUAL_LINE]);
    expect(plan.writes).toEqual([]);
  });

  it('gives a multi-use grant its use back', () => {
    const once = unwrapOk(
      CouponGrantSystem.burn(freshGrant('grant-3', multiUse(3)), at(1), 'x'),
    );
    expect(
      CouponGrantSystem.releasePlan([grantLine('grant-3')], [once]).writes,
    ).toMatchObject([
      { fields: { grantStatus: 'ACTIVE', usesRemaining: 3, usesGranted: 3 } },
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const discounts = deepFreeze([grantLine('grant-1'), MANUAL_LINE]);
    const grants = deepFreeze([
      unwrapOk(CouponGrantSystem.burn(freshGrant('grant-1'), at(1), 'x')),
    ]);
    expect(CouponGrantSystem.releasePlan(discounts, grants)).toEqual(
      CouponGrantSystem.releasePlan(discounts, grants),
    );
    expect(discounts).toHaveLength(2);
    expect(grants[0]?.grantStatus).toBe(GrantStatus.Used);
  });
});
