import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import { BarberPrefKind } from './barber-pref.data';
import { SchedulingError } from './scheduling-errors.data';
import { SeatLabel } from './seat-label.data';
import { SeatOutcome } from './seat-outcome.data';
import { ServiceTerms } from './service-terms.data';
import {
  Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
  SeatSubjectKind,
} from './seat.data';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 7, 7, 0); // 10:00 in Sofia
const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');
const OWNER = UserId.of('u-owner');
const OTHER = UserId.of('u-other');

const CUT = ServiceTerms.of(2800, 'EUR', 30, 5, 10);

function seat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: SeatId.of('s1'),
    serviceId: ServiceId.of('svc-cut'),
    variantId: null,
    barberId: IVAN,
    barberPref: BarberPrefKind.Specific,
    terms: Seat.termsOf(CUT, null),
    startMs: T0,
    subject: SeatSubject.anonymous(SeatLabel.of('Walk-in 10:00')),
    outcome: SeatOutcome.scheduled(),
    tip: null,
    ...overrides,
  };
}

describe('SeatSubject', () => {
  it('anonymous subjects are contactless, accounts are not', () => {
    expect(SeatSubject.isContactless(seat().subject)).toBe(true);
    expect(Seat.isContactless(seat())).toBe(true);
    expect(
      Seat.isContactless(
        seat({ subject: SeatSubject.account(OWNER, SeatRelationship.Self) }),
      ),
    ).toBe(false);
    expect(
      SeatSubject.isContactless(
        SeatSubject.account(OWNER, SeatRelationship.Self),
      ),
    ).toBe(false);
    expect(SeatSubject.account(OWNER, SeatRelationship.Companion)).toEqual({
      kind: SeatSubjectKind.Account,
      userId: OWNER,
      relationship: 'companion',
    });
  });
});

describe('Seat — the end is DERIVED from the sold duration', () => {
  it('ends at start plus the snapshotted duration', () => {
    expect(Seat.endMs(seat())).toBe(T0 + 30 * MIN);
    expect(Seat.interval(seat())).toEqual({
      startMs: T0,
      endMs: T0 + 30 * MIN,
    });
  });

  it('sells the slot alone — the chair is held for setup and cleanup around it', () => {
    expect(Seat.chairTime(seat())).toEqual({
      startMs: T0 - 5 * MIN,
      endMs: T0 + 40 * MIN,
    });
  });
});

describe('Seat.collidesWith', () => {
  it('collides when the same barber has overlapping slots', () => {
    const other = seat({ id: SeatId.of('s2'), startMs: T0 + 15 * MIN });
    expect(Seat.collidesWith(seat(), other)).toBe(true);
    expect(Seat.collidesWith(other, seat())).toBe(true);
  });

  it('does NOT collide when the same barber works back to back', () => {
    const other = seat({ id: SeatId.of('s2'), startMs: T0 + 30 * MIN });
    expect(Seat.collidesWith(seat(), other)).toBe(false);
  });

  it('does NOT collide when different barbers work at the same time', () => {
    const other = seat({ id: SeatId.of('s2'), barberId: STEFAN });
    expect(Seat.collidesWith(seat(), other)).toBe(false);
  });
});

describe('Seat.termsOf — override provenance', () => {
  it('records the catalogue figures only when staff changed something', () => {
    const discounted = ServiceTerms.of(2000, 'EUR', 30, 5, 10);
    expect(Seat.termsOf(discounted, CUT)).toEqual({
      ...discounted,
      catalogPriceMinorUnits: 2800,
      catalogDurationMinutes: 30,
    });
    expect(
      Seat.overridden(seat({ terms: Seat.termsOf(discounted, CUT) })),
    ).toBe(true);
  });

  it('normalises catalogue terms EQUAL to the charged ones to no override', () => {
    const terms = Seat.termsOf(CUT, ServiceTerms.of(2800, 'EUR', 30, 5, 10));
    expect(terms.catalogPriceMinorUnits).toBeNull();
    expect(terms.catalogDurationMinutes).toBeNull();
    expect(Seat.overridden(seat({ terms }))).toBe(false);
  });
});

describe('Seat transitions carry every field', () => {
  const tipped = seat({
    terms: Seat.termsOf(ServiceTerms.of(2000, 'EUR', 30, 5, 10), CUT),
    tip: { amountMinorUnits: 500, currencyCode: 'EUR' },
  });

  it('withOutcome changes the outcome and nothing else', () => {
    const resolved = Seat.withOutcome(tipped, SeatOutcome.worked(T0));
    expect(resolved).toEqual({
      ...tipped,
      outcome: { kind: 'worked', atMs: T0 },
    });
    expect(tipped.outcome).toEqual({ kind: 'scheduled' });
  });

  it('withTip changes the tip and nothing else; null clears it to "not recorded"', () => {
    expect(Seat.withTip(tipped, null)).toEqual({ ...tipped, tip: null });
    const zero = { amountMinorUnits: 0, currencyCode: 'EUR' };
    expect(Seat.withTip(tipped, zero).tip).toEqual(zero);
  });

  it('a tip survives any run of outcome corrections', () => {
    let current = tipped;
    for (const outcome of [
      SeatOutcome.noShow(T0),
      SeatOutcome.scheduled(),
      SeatOutcome.worked(T0),
    ]) {
      current = Seat.withOutcome(current, outcome);
    }
    expect(current.tip).toEqual(tipped.tip);
    expect(current.terms).toEqual(tipped.terms);
  });
});

describe('Seat.isMovableByBooker — the ONE rule for whose seat a client move rebuilds', () => {
  const own = seat({
    subject: SeatSubject.account(OWNER, SeatRelationship.Self),
  });

  it('is the booker’s for their own self seat', () => {
    expect(Seat.isMovableByBooker(own, OWNER)).toBe(true);
  });

  it('is the booker’s for an anonymous guest', () => {
    expect(Seat.isMovableByBooker(seat(), OWNER)).toBe(true);
    expect(Seat.isMovableByBooker(seat(), null)).toBe(true);
  });

  it('is the SHOP’s for a companion or a client the shop seated', () => {
    for (const relationship of [
      SeatRelationship.Companion,
      SeatRelationship.Client,
    ]) {
      const shops = seat({ subject: SeatSubject.account(OWNER, relationship) });
      expect(Seat.isMovableByBooker(shops, OWNER)).toBe(false);
    }
  });

  it('is the shop’s for a self seat bound to ANOTHER account', () => {
    expect(Seat.isMovableByBooker(own, OTHER)).toBe(false);
  });

  it('gives no account seat to nobody', () => {
    expect(Seat.isMovableByBooker(own, null)).toBe(false);
  });

  it('is exactly "anonymous, or self AND the owner’s own account" (property)', () => {
    const subjects = fc.oneof(
      fc.constant(SeatSubject.anonymous(SeatLabel.of('Guest'))),
      fc
        .tuple(
          fc.constantFrom(OWNER, OTHER),
          fc.constantFrom(...Object.values(SeatRelationship)),
        )
        .map(([userId, relationship]) =>
          SeatSubject.account(userId, relationship),
        ),
    );
    fc.assert(
      fc.property(
        subjects,
        fc.constantFrom(OWNER, OTHER, null),
        (subject, owner) => {
          const expected =
            subject.kind === SeatSubjectKind.Anonymous ||
            (subject.relationship === SeatRelationship.Self &&
              owner !== null &&
              subject.userId === owner);
          return Seat.isMovableByBooker(seat({ subject }), owner) === expected;
        },
      ),
    );
  });
});

describe('Seat.violations — the aggregate invariants, every one at once', () => {
  const self = (userId: UserId) =>
    SeatSubject.account(userId, SeatRelationship.Self);

  it('refuses no seats at all, alone', () => {
    expect(Seat.violations([])).toEqual([
      SchedulingError.appointmentEmptySeats(),
    ]);
  });

  it('accepts sequential self seats and self seats of two accounts', () => {
    const first = seat({ subject: self(OWNER) });
    const second = seat({
      id: SeatId.of('s2'),
      barberId: STEFAN,
      subject: self(OWNER),
      startMs: T0 + 30 * MIN,
    });
    const other = seat({
      id: SeatId.of('s3'),
      barberId: STEFAN,
      subject: self(OTHER),
    });
    expect(Seat.violations([first, second])).toEqual([]);
    expect(Seat.violations([first, other])).toEqual([]);
  });

  it('refuses one person in two chairs once, and names a double-booked barber once', () => {
    const a = seat({ subject: self(OWNER) });
    const b = seat({
      id: SeatId.of('s2'),
      subject: self(OWNER),
      startMs: T0 + 10 * MIN,
    });
    const c = seat({ id: SeatId.of('s3'), startMs: T0 + 20 * MIN });
    expect(Seat.violations([a, b, c])).toEqual([
      SchedulingError.appointmentMultipleSelfSeats(),
      SchedulingError.appointmentBarberDoubleBooked(IVAN),
    ]);
  });

  it('refuses seats priced in two currencies, the first mismatch only', () => {
    const usd = ServiceTerms.of(2800, 'USD', 30, 0, 0);
    const gbp = ServiceTerms.of(2800, 'GBP', 30, 0, 0);
    expect(
      Seat.violations([
        seat(),
        seat({
          id: SeatId.of('s2'),
          barberId: STEFAN,
          terms: Seat.termsOf(usd, null),
        }),
        seat({
          id: SeatId.of('s3'),
          barberId: BarberId.of('niko'),
          terms: Seat.termsOf(gbp, null),
        }),
      ]),
    ).toEqual([SchedulingError.appointmentMixedCurrency('EUR', 'USD')]);
  });
});
