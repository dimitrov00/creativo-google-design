import { Money, Result, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { UserId } from '@creativo/domain/accounts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberPref } from './barber-pref';
import { CancellationWindow } from './cancellation-window';
import { SeatId } from './ids';
import { SeatLabel } from './seat-label';
import { Seat, SeatProps, SeatSubject } from './seat';
import {
  CancellationReason,
  SEAT_SCHEDULED,
  SeatOutcome,
  seatCancelled,
  seatNoShow,
  seatWorked,
} from './seat-outcome';

const zone = 'Europe/Sofia';

function startOf(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function terms(durationMinutes: number, priceMinorUnits = 1500): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(priceMinorUnits, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, durationMinutes);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** A seat's length now comes from ONE place: its terms. */
function seat(
  overrides: {
    barberId?: BarberId;
    startIso?: string;
    durationMinutes?: number;
    variantId?: ServiceVariantId | null;
  } = {},
): Seat {
  const startsAt = ZonedDateTime.fromISO(
    overrides.startIso ?? '2026-06-01T10:00:00',
    zone,
  );
  if (startsAt.isFailure()) throw new Error('bad fixture');
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: overrides.variantId ?? null,
    barberId: overrides.barberId ?? BarberId.generate(),
    terms: terms(overrides.durationMinutes ?? 30),
    startsAt: startsAt.value,
  });
}

describe('SeatSubject', () => {
  it('anonymous subjects are contactless', () => {
    const label = SeatLabel.create('Walk-in 14:30');
    if (label.isFailure()) throw new Error('bad fixture');
    const subject = SeatSubject.anonymous(label.value);
    expect(SeatSubject.isContactless(subject)).toBe(true);
  });

  it('account subjects are not contactless', () => {
    const subject = SeatSubject.account(UserId.generate(), 'self');
    expect(SeatSubject.isContactless(subject)).toBe(false);
  });
});

describe('Seat.of', () => {
  it('assembles a seat for an anonymous subject', () => {
    const label = SeatLabel.create('Walk-in 14:30');
    if (label.isFailure()) throw new Error('bad fixture');
    const built = Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.anonymous(label.value),
      serviceId: ServiceId.generate(),
      variantId: null,
      barberId: BarberId.generate(),
      terms: terms(30),
      startsAt: startOf('2026-06-01T10:00:00'),
    });
    expect(built.isContactless()).toBe(true);
  });

  it('assembles a seat for a registered account subject', () => {
    const built = seat();
    expect(built.isContactless()).toBe(false);
    expect(built.subject.kind).toBe('account');
  });

  it('carries the variant chosen within the service', () => {
    const variantId = ServiceVariantId.create('long');
    if (variantId.isFailure()) throw new Error('bad fixture');
    expect(seat({ variantId: variantId.value }).variantId?.value).toBe('long');
  });

  it('DERIVES its slot from the start plus the snapshotted duration', () => {
    // The seat states its length exactly once. A slot that disagreed with
    // the terms used to be representable, and conflict detection and
    // utilisation would then disagree forever with no error anywhere.
    const built = seat({
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    expect(built.durationMinutes()).toBe(45);
    expect(built.slot.durationMinutes()).toBe(45);
    expect(built.slot.end.hour).toBe(10);
    expect(built.slot.end.minute).toBe(45);
    expect(built.endsAt().equals(built.slot.end)).toBe(true);
  });

  it('sells the slot alone — `soldTime` is the service, without the barber’s setup and cleanup', () => {
    const price = Money.fromMinorUnitsAndCode(1500, 'EUR');
    if (price.isFailure()) throw new Error('bad fixture');
    const padded = ServiceTerms.create(price.value, 45, {
      setupMinutes: 5,
      cleanupMinutes: 10,
    });
    if (padded.isFailure()) throw new Error('bad fixture');
    const built = Seat.of({ ...seat().toProps(), terms: padded.value });

    expect(built.soldTime()).toEqual({
      startMs: built.slot.start.toMillis(),
      endMs: built.slot.end.toMillis(),
    });
    // …while the chair is held five minutes before and ten after it.
    expect(built.chairTime().startMs).toBe(
      built.soldTime().startMs - 5 * 60_000,
    );
    expect(built.chairTime().endMs).toBe(built.soldTime().endMs + 10 * 60_000);
  });
});

describe('Seat.collidesWith', () => {
  const IVAN = BarberId.generate();
  const NIKO = BarberId.generate();

  it('collides when the same barber has overlapping slots', () => {
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:30:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(true);
    expect(b.collidesWith(a)).toBe(true);
  });

  it('does NOT collide when the same barber works back to back', () => {
    // Half-open intervals: 10:45 ends exactly as the next begins.
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:45:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(false);
  });

  it('does NOT collide when different barbers work at the same time', () => {
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: NIKO,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(false);
  });
});

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

function eur(minorUnits: number): Money {
  return unwrap(Money.fromMinorUnitsAndCode(minorUnits, 'EUR'));
}

const anyUuid = fc.uuid();

const anySubject: fc.Arbitrary<SeatSubject> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((raw) => raw.trim().length > 0)
    .map((raw) => SeatSubject.anonymous(unwrap(SeatLabel.create(raw)))),
  fc
    .tuple(
      anyUuid,
      fc.constantFrom('self', 'companion', 'client') as fc.Arbitrary<
        'self' | 'companion' | 'client'
      >,
    )
    .map(([uid, relationship]) =>
      SeatSubject.account(unwrap(UserId.create(uid)), relationship),
    ),
);

const anyPref: fc.Arbitrary<BarberPref | null> = fc.option(
  fc.oneof(
    fc.constant(BarberPref.any()),
    anyUuid.map((uid) => BarberPref.specific(unwrap(BarberId.create(uid)))),
  ),
  { nil: null },
);

/**
 * The seat's terms and, half the time, a catalogue answer that DIFFERS from
 * them — an equal one is normalised to `null` by `Seat.of`, and would never
 * exercise the provenance a transition must carry.
 */
const anyPricing = fc
  .record({
    price: fc.nat({ max: 100_000 }),
    duration: fc.integer({ min: 1, max: 480 }),
    setup: fc.nat({ max: 30 }),
    cleanup: fc.nat({ max: 30 }),
    discount: fc.option(fc.integer({ min: 1, max: 5_000 }), { nil: null }),
  })
  .map(({ price, duration, setup, cleanup, discount }) => {
    const build = (minorUnits: number) =>
      unwrap(
        ServiceTerms.fromMinorUnits(minorUnits, 'EUR', duration, {
          setupMinutes: setup,
          cleanupMinutes: cleanup,
        }),
      );
    return {
      terms: build(price),
      catalogTerms: discount === null ? null : build(price + discount),
    };
  });

const anyInstant = fc.integer({
  min: Date.UTC(2024, 0, 1),
  max: Date.UTC(2030, 0, 1),
});

const anyReason: fc.Arbitrary<CancellationReason> = fc.oneof(
  fc
    .constantFrom(
      'client_changed_plans',
      'client_unwell',
      'staff_barber_absence',
      'staff_shop_closure',
      'no_show_converted',
      'unspecified',
    )
    .map((kind) => ({ kind }) as CancellationReason),
  fc
    .string({ minLength: 1 })
    .map((note): CancellationReason => ({ kind: 'other', note })),
);

const anyOutcome: fc.Arbitrary<SeatOutcome> = fc.oneof(
  fc.constant(SEAT_SCHEDULED),
  anyInstant.map(seatWorked),
  anyInstant.map(seatNoShow),
  fc
    .tuple(
      anyInstant,
      fc.constantFrom('client', 'staff') as fc.Arbitrary<'client' | 'staff'>,
      anyReason,
      // The window in force, or none for a cancellation older than the stamp.
      fc.option(
        fc
          .nat({ max: 168 })
          .map((hours) => unwrap(CancellationWindow.create(hours))),
        { nil: null },
      ),
    )
    .map(([atMs, by, reason, window]) =>
      seatCancelled(atMs, by, reason, window),
    ),
);

const anyTip: fc.Arbitrary<Money | null> = fc.option(
  fc.nat({ max: 20_000 }).map(eur),
  { nil: null },
);

/**
 * EVERY field, `Required` like `Seat.toProps()`: a field added to `SeatProps`
 * fails to compile here until it is generated, and the checks below then
 * cover it without being edited.
 */
const anySeatProps: fc.Arbitrary<Required<SeatProps>> = fc
  .record({
    id: anyUuid.map((raw) => unwrap(SeatId.create(raw))),
    subject: anySubject,
    serviceId: anyUuid.map((raw) => unwrap(ServiceId.create(raw))),
    variantId: fc.option(
      anyUuid.map((raw) => unwrap(ServiceVariantId.create(raw))),
      { nil: null },
    ),
    barberId: anyUuid.map((raw) => unwrap(BarberId.create(raw))),
    pref: anyPref,
    pricing: anyPricing,
    startsAt: anyInstant.map((ms) =>
      unwrap(ZonedDateTime.fromMillis(ms, zone)),
    ),
    outcome: anyOutcome,
    tip: anyTip,
  })
  .map(({ pricing, ...rest }) => ({ ...rest, ...pricing }));

/** `after` holds the very same value as `expected` in every field but `changed`. */
function expectCarried(
  after: Seat,
  expected: Required<SeatProps>,
  changed?: keyof SeatProps,
): void {
  const props = new Map(Object.entries(after.toProps()));
  expect([...props.keys()].sort()).toEqual(Object.keys(expected).sort());
  for (const [field, value] of Object.entries(expected)) {
    if (field === changed) continue;
    expect(props.get(field), field).toBe(value);
  }
}

describe('Seat transitions carry every field', () => {
  it('a tipped, discounted seat keeps its tip and catalogue terms when resolved', () => {
    // The defect this guards: `withOutcome` rebuilt the seat without the tip
    // and the override provenance, so completing a visit erased both.
    const catalogue = terms(30, 2000);
    const tip = eur(500);
    const base = Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.account(UserId.generate(), 'self'),
      serviceId: ServiceId.generate(),
      variantId: null,
      barberId: BarberId.generate(),
      terms: terms(30, 1500),
      catalogTerms: catalogue,
      startsAt: startOf('2026-06-01T10:00:00'),
      pref: BarberPref.any(),
      tip,
    });

    const worked = base.withOutcome(seatWorked(Date.UTC(2026, 5, 1, 8, 30)));

    expect(worked.outcome.kind).toBe('worked');
    expect(worked.tip).toBe(tip);
    expect(worked.catalogTerms).toBe(catalogue);
    expect(worked.overridden()).toBe(true);
    expect(worked.pref).toEqual(BarberPref.any());
  });

  it('toProps reads back every field Seat.of was given', () => {
    fc.assert(
      fc.property(anySeatProps, (props) => {
        expectCarried(Seat.of(props), props);
      }),
    );
  });

  it('withOutcome changes the outcome and nothing else', () => {
    fc.assert(
      fc.property(anySeatProps, anyOutcome, (props, outcome) => {
        const before = Seat.of(props);
        const after = before.withOutcome(outcome);

        expect(after.outcome).toBe(outcome);
        expectCarried(after, props, 'outcome');
        expect(after.overridden()).toBe(before.overridden());
        expect(after.endsAt().equals(before.endsAt())).toBe(true);
        // Immutable: the seat it was called on is untouched.
        expect(before.outcome).toBe(props.outcome);
      }),
    );
  });

  it('withTip changes the tip and nothing else', () => {
    fc.assert(
      fc.property(anySeatProps, anyTip, (props, tip) => {
        const before = Seat.of(props);
        const after = before.withTip(tip);

        expect(after.tip).toBe(tip);
        expectCarried(after, props, 'tip');
        expect(before.tip).toBe(props.tip);
      }),
    );
  });

  it('a tip survives any run of outcome corrections', () => {
    fc.assert(
      fc.property(
        anySeatProps,
        anyTip,
        fc.array(anyOutcome, { minLength: 1, maxLength: 5 }),
        (props, tip, outcomes) => {
          const settled = outcomes.reduce(
            (seat, outcome) => seat.withOutcome(outcome),
            Seat.of(props).withTip(tip),
          );
          expect(settled.tip).toBe(tip);
          expect(settled.catalogTerms).toBe(props.catalogTerms);
          expect(settled.outcome).toBe(outcomes[outcomes.length - 1]);
        },
      ),
    );
  });
});

describe('Seat.isMovableByBooker — the ONE rule for whose seat a client move rebuilds', () => {
  const OWNER = unwrap(UserId.create('user-owner'));
  const SOMEONE_ELSE = unwrap(UserId.create('user-other'));

  function withSubject(subject: SeatSubject): Seat {
    return Seat.of({ ...seat().toProps(), subject });
  }

  it('is the booker’s for their own `self` seat', () => {
    expect(
      withSubject(SeatSubject.account(OWNER, 'self')).isMovableByBooker(OWNER),
    ).toBe(true);
  });

  it('is the booker’s for an anonymous guest — the cart names guests by label', () => {
    const guest = withSubject(
      SeatSubject.anonymous(unwrap(SeatLabel.create('Мария'))),
    );
    expect(guest.isMovableByBooker(OWNER)).toBe(true);
    // Nobody signed in to claim a `self` seat still leaves the guests.
    expect(guest.isMovableByBooker(null)).toBe(true);
  });

  it('is the SHOP’s for a companion or a client the shop seated', () => {
    expect(
      withSubject(
        SeatSubject.account(SOMEONE_ELSE, 'companion'),
      ).isMovableByBooker(OWNER),
    ).toBe(false);
    expect(
      withSubject(SeatSubject.account(OWNER, 'client')).isMovableByBooker(
        OWNER,
      ),
    ).toBe(false);
  });

  it('is the shop’s for a `self` seat bound to ANOTHER account — the relationship alone is not ownership', () => {
    expect(
      withSubject(SeatSubject.account(SOMEONE_ELSE, 'self')).isMovableByBooker(
        OWNER,
      ),
    ).toBe(false);
  });

  it('gives no account seat to nobody', () => {
    expect(
      withSubject(SeatSubject.account(OWNER, 'self')).isMovableByBooker(null),
    ).toBe(false);
  });

  it('is exactly "anonymous, or self AND the owner’s own account" (property)', () => {
    fc.assert(
      fc.property(anySubject, fc.boolean(), (subject, ownerIsTheSubject) => {
        const owner =
          ownerIsTheSubject && subject.kind === 'account'
            ? subject.userId
            : SOMEONE_ELSE;
        const expected =
          subject.kind === 'anonymous' ||
          (subject.relationship === 'self' && subject.userId.equals(owner));
        expect(withSubject(subject).isMovableByBooker(owner)).toBe(expected);
      }),
    );
  });
});
