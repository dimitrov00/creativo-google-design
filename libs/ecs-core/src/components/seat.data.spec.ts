import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Currency,
  DurationMinutes,
  MinuteCount,
  BarberId,
  SeatId,
  ServiceId,
  UserId,
  PriceCents,
  UtcEpochMs,
  SchedulingError,
} from '@core/primitives';
import { minute, unwrapOk, customerOf } from '@core/testing';
import { BarberPreference } from './barber-pref.data';
import { SeatLabel } from './seat-label.data';
import { SeatOutcome } from './seat-outcome.data';
import { ServiceTerms } from './service-terms.data';
import {
  Seat,
  type SeatCore,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from './seat.data';

const T0 = minute(600); // 10:00 on the shop's wall clock
const STAMP = unwrapOk(UtcEpochMs.of(1_791_356_400_000));
const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');
const OWNER = UserId.of('u-owner');
const OTHER = UserId.of('u-other');

function terms(
  price: number,
  currency: Currency,
  duration: number,
  setup: number,
  cleanup: number,
): ServiceTerms {
  return ServiceTerms.of(
    unwrapOk(PriceCents.of(price)),
    currency,
    unwrapOk(DurationMinutes.of(duration)),
    unwrapOk(MinuteCount.of(setup)),
    unwrapOk(MinuteCount.of(cleanup)),
  );
}

const CUT = terms(2800, Currency.EUR, 30, 5, 10);

type SeatOverrides = Partial<SeatCore> & {
  readonly occupant?: SeatOccupant;
  readonly outcome?: SeatOutcome;
  readonly charged?: ServiceTerms;
  readonly catalog?: ServiceTerms | null;
};

function seat(overrides: SeatOverrides = {}): Seat {
  const { occupant, outcome, charged, catalog, ...core } = overrides;
  return Seat.compose(
    {
      seatId: SeatId.of('s1'),
      serviceId: ServiceId.of('svc-cut'),
      variantId: null,
      barberId: IVAN,
      barberPreference: BarberPreference.Specific,
      startMinutes: T0,
      tipCents: null,
      ...core,
    },
    Seat.termsOf(charged ?? CUT, catalog ?? null),
    occupant ?? SeatOccupant.anonymous(SeatLabel.of('Walk-in 10:00')),
    outcome ?? SeatOutcome.scheduled(),
  );
}

describe('SeatOccupant', () => {
  it('anonymous subjects are contactless, accounts are not', () => {
    expect(SeatOccupant.isContactless(seat())).toBe(true);
    expect(Seat.isContactless(seat())).toBe(true);
    expect(
      Seat.isContactless(
        seat({
          occupant: SeatOccupant.account(
            OWNER,
            customerOf(OWNER),
            SubjectRelationship.Self,
          ),
        }),
      ),
    ).toBe(false);
    expect(
      SeatOccupant.isContactless(
        SeatOccupant.account(
          OWNER,
          customerOf(OWNER),
          SubjectRelationship.Self,
        ),
      ),
    ).toBe(false);
    expect(
      SeatOccupant.account(
        OWNER,
        customerOf(OWNER),
        SubjectRelationship.Companion,
      ),
    ).toEqual({
      seatSubject: SeatSubject.Account,
      subjectUserId: OWNER,
      subjectCustomerId: customerOf(OWNER),
      subjectRelationship: 'COMPANION',
    });
  });

  it('copies exactly one variant — the client record kept by `of`, left behind by `accountOf` (D29)', () => {
    const account = SeatOccupant.account(
      OWNER,
      customerOf(OWNER),
      SubjectRelationship.Self,
    );
    const whole = seat({ occupant: account });
    expect(SeatOccupant.of(whole)).toEqual(account);
    expect(SeatOccupant.accountOf(whole)).toEqual({
      seatSubject: SeatSubject.Account,
      subjectUserId: OWNER,
      subjectRelationship: SubjectRelationship.Self,
    });
    const guest = SeatOccupant.anonymous(SeatLabel.of('Гост'));
    expect(SeatOccupant.of(seat({ occupant: guest }))).toEqual(guest);
    expect(SeatOccupant.accountOf(seat({ occupant: guest }))).toEqual(guest);
  });

  it('is flat at the seat element’s root', () => {
    expect(seat()).toMatchObject({
      seatId: 's1',
      seatSubject: 'ANONYMOUS',
      guestLabel: 'Walk-in 10:00',
      attendanceState: 'SCHEDULED',
      priceCents: 2800,
      currency: 'EUR',
      durationMinutes: 30,
    });
  });
});

describe('Seat.composeAccount — the account-rules view (D29)', () => {
  it('is compose’s seat in compose’s field order, the client record left out', () => {
    const occupant = SeatOccupant.account(
      OWNER,
      customerOf(OWNER),
      SubjectRelationship.Self,
    );
    const whole = seat({ occupant });
    const view = Seat.composeAccount(
      whole,
      whole,
      {
        seatSubject: SeatSubject.Account,
        subjectUserId: OWNER,
        subjectRelationship: SubjectRelationship.Self,
      },
      whole,
    );
    const recordless: Record<string, unknown> = { ...whole };
    delete recordless['subjectCustomerId'];
    expect(view).toEqual(recordless);
    expect(Object.keys(view)).toEqual(Object.keys(recordless));
    // A whole seat passed as the occupant leaves its record behind too.
    expect(Seat.composeAccount(whole, whole, whole, whole)).toEqual(recordless);
  });

  it('keeps an anonymous guest as it is', () => {
    const guest = seat();
    expect(Seat.composeAccount(guest, guest, guest, guest)).toEqual(guest);
  });
});

describe('Seat — the end is DERIVED from the sold duration', () => {
  it('ends at start plus the snapshotted duration', () => {
    expect(Seat.endMinutes(seat())).toBe(630);
    expect(Seat.range(seat())).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it('sells the slot alone — the chair is held for setup and cleanup around it', () => {
    expect(Seat.chairTime(seat())).toEqual({
      startMinutes: 595,
      endMinutes: 640,
    });
  });

  it('clips the chair time to the shop day (T7)', () => {
    const early = seat({ startMinutes: minute(2) });
    expect(Seat.chairTime(early).startMinutes).toBe(0);
    const late = seat({ startMinutes: minute(1405) });
    expect(Seat.chairTime(late).endMinutes).toBe(1440);
  });
});

describe('Seat.collidesWith', () => {
  it('collides when the same barber has overlapping slots', () => {
    const other = seat({ seatId: SeatId.of('s2'), startMinutes: minute(615) });
    expect(Seat.collidesWith(seat(), other)).toBe(true);
    expect(Seat.collidesWith(other, seat())).toBe(true);
  });

  it('does NOT collide when the same barber works back to back', () => {
    const other = seat({ seatId: SeatId.of('s2'), startMinutes: minute(630) });
    expect(Seat.collidesWith(seat(), other)).toBe(false);
  });

  it('does NOT collide when different barbers work at the same time', () => {
    const other = seat({ seatId: SeatId.of('s2'), barberId: STEFAN });
    expect(Seat.collidesWith(seat(), other)).toBe(false);
  });
});

describe('Seat.termsOf — override provenance', () => {
  it('records the catalogue figures only when staff changed something', () => {
    const discounted = terms(2000, Currency.EUR, 30, 5, 10);
    expect(Seat.termsOf(discounted, CUT)).toEqual({
      ...discounted,
      catalogPriceCents: 2800,
      catalogDurationMinutes: 30,
    });
    expect(Seat.overridden(seat({ charged: discounted, catalog: CUT }))).toBe(
      true,
    );
  });

  it('normalises catalogue terms EQUAL to the charged ones to no override', () => {
    const normalised = Seat.termsOf(CUT, terms(2800, Currency.EUR, 30, 5, 10));
    expect(normalised.catalogPriceCents).toBeNull();
    expect(normalised.catalogDurationMinutes).toBeNull();
    expect(Seat.overridden(seat({ catalog: CUT }))).toBe(false);
  });
});

describe('Seat transitions carry every field', () => {
  const tipped = seat({
    charged: terms(2000, Currency.EUR, 30, 5, 10),
    catalog: CUT,
    tipCents: unwrapOk(PriceCents.of(500)),
  });

  it('withOutcome changes the outcome and nothing else', () => {
    const resolved = Seat.withOutcome(tipped, SeatOutcome.worked(STAMP));
    expect(resolved).toEqual({
      ...tipped,
      attendanceState: 'WORKED',
      workedAtUtcMs: STAMP,
    });
    expect(tipped.attendanceState).toBe('SCHEDULED');
  });

  it('withOutcome drops the old outcome’s variant fields', () => {
    const cancelled = Seat.withOutcome(
      tipped,
      SeatOutcome.cancelled(STAMP, 'CLIENT', 'CLIENT_UNWELL', 24),
    );
    const reopened = Seat.withOutcome(cancelled, SeatOutcome.scheduled());
    expect(reopened).toEqual(tipped);
    expect(Object.keys(reopened)).toEqual(Object.keys(tipped));
  });

  it('withTip changes the tip and nothing else; null clears it to "not recorded"', () => {
    expect(Seat.withTip(tipped, null)).toEqual({ ...tipped, tipCents: null });
    expect(Seat.withTip(tipped, PriceCents.ZERO).tipCents).toBe(0);
  });

  it('a tip survives any run of outcome corrections', () => {
    let current = tipped;
    for (const outcome of [
      SeatOutcome.noShow(STAMP),
      SeatOutcome.scheduled(),
      SeatOutcome.worked(STAMP),
    ]) {
      current = Seat.withOutcome(current, outcome);
    }
    expect(current.tipCents).toBe(tipped.tipCents);
    expect(current.priceCents).toBe(tipped.priceCents);
    expect(current.catalogPriceCents).toBe(tipped.catalogPriceCents);
  });
});

describe('Seat.isMovableByBooker — the ONE rule for whose seat a client move rebuilds', () => {
  const own = seat({
    occupant: SeatOccupant.account(
      OWNER,
      customerOf(OWNER),
      SubjectRelationship.Self,
    ),
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
      SubjectRelationship.Companion,
      SubjectRelationship.Client,
    ]) {
      const shops = seat({
        occupant: SeatOccupant.account(OWNER, customerOf(OWNER), relationship),
      });
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
    const occupants = fc.oneof(
      fc.constant<SeatOccupant>(SeatOccupant.anonymous(SeatLabel.of('Guest'))),
      fc
        .tuple(
          fc.constantFrom(OWNER, OTHER),
          fc.constantFrom(...Object.values(SubjectRelationship)),
        )
        .map(([userId, relationship]): SeatOccupant =>
          SeatOccupant.account(userId, customerOf(userId), relationship),
        ),
    );
    fc.assert(
      fc.property(
        occupants,
        fc.constantFrom(OWNER, OTHER, null),
        (occupant, owner) => {
          const expected =
            occupant.seatSubject === SeatSubject.Anonymous ||
            (occupant.subjectRelationship === SubjectRelationship.Self &&
              owner !== null &&
              occupant.subjectUserId === owner);
          return Seat.isMovableByBooker(seat({ occupant }), owner) === expected;
        },
      ),
    );
  });
});

describe('Seat.violations — the aggregate invariants, every one at once', () => {
  const self = (userId: UserId) =>
    SeatOccupant.account(userId, customerOf(userId), SubjectRelationship.Self);

  it('refuses no seats at all, alone', () => {
    expect(Seat.violations([])).toEqual([
      SchedulingError.appointmentEmptySeats(),
    ]);
  });

  it('accepts sequential self seats and self seats of two accounts', () => {
    const first = seat({ occupant: self(OWNER) });
    const second = seat({
      seatId: SeatId.of('s2'),
      barberId: STEFAN,
      occupant: self(OWNER),
      startMinutes: minute(630),
    });
    const other = seat({
      seatId: SeatId.of('s3'),
      barberId: STEFAN,
      occupant: self(OTHER),
    });
    expect(Seat.violations([first, second])).toEqual([]);
    expect(Seat.violations([first, other])).toEqual([]);
  });

  it('refuses one person in two chairs once, and names a double-booked barber once', () => {
    const a = seat({ occupant: self(OWNER) });
    const b = seat({
      seatId: SeatId.of('s2'),
      occupant: self(OWNER),
      startMinutes: minute(610),
    });
    const c = seat({ seatId: SeatId.of('s3'), startMinutes: minute(620) });
    expect(Seat.violations([a, b, c])).toEqual([
      SchedulingError.appointmentMultipleSelfSeats(),
      SchedulingError.appointmentBarberDoubleBooked(IVAN),
    ]);
  });

  it('refuses seats priced in two currencies, the first mismatch only', () => {
    const usd = terms(2800, Currency.USD, 30, 0, 0);
    const gbp = terms(2800, Currency.GBP, 30, 0, 0);
    expect(
      Seat.violations([
        seat(),
        seat({ seatId: SeatId.of('s2'), barberId: STEFAN, charged: usd }),
        seat({
          seatId: SeatId.of('s3'),
          barberId: BarberId.of('niko'),
          charged: gbp,
        }),
      ]),
    ).toEqual([
      SchedulingError.appointmentMixedCurrency(Currency.EUR, Currency.USD),
    ]);
  });
});
