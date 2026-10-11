import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { CouponCombinability, CouponValue } from '@creativo/domain/engagement';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import {
  AppliedDiscount,
  Appointment,
  CANCELLATION_WINDOW_MAX_HOURS,
  CancellationWindow,
  COMPLETED,
  CONFIRMED,
  PENDING,
  Seat,
  SeatId,
  SeatSubject,
  cancelled,
  seatCancelled,
  seatNoShow,
  seatWorked,
  VoucherRedemption,
} from '@creativo/domain/scheduling';
import {
  appointmentFromDocument,
  appointmentToDocument,
  bookedAtFromDocument,
  busyContributionsOf,
  busyDocumentId,
  liveStoodSeatPairs,
  persistedChairTimesOf,
  preservedAppointmentFields,
  revisionOf,
  STOOD_SEAT_PAIRS_FIELD,
  stoodSeatPairsFromDocument,
  withStoodSeatPairs,
  seatOutcomeFromDocument,
  seatOutcomeToDocument,
  discountsFromDocument,
  couponValueFromDocument,
  voucherRedemptionsFromDocument,
} from './appointment-document';

const ZONE = 'Europe/Sofia';
const RESOLVED_AT_MS = Date.UTC(2026, 7, 5, 9, 0, 0);

function windowOf(hours: number): CancellationWindow {
  const result = CancellationWindow.create(hours);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, ZONE);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function terms(): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(1500, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, 30);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function seat(): Seat {
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: BarberId.generate(),
    terms: terms(),
    startsAt: at('2026-06-01T10:00:00'),
  });
}

function appointment(now = at('2026-05-01T09:00:00')): Appointment {
  const result = Appointment.create({
    id: 'appointment-2',
    locationId: LocationId.generate().toString(),
    seats: [seat()],
    now,
    bookedFromAppointmentId: 'appointment-1',
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('appointmentToDocument — write-time captures', () => {
  it('writes the booking instant with the zone that makes it renderable', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(document['bookedAt']).toEqual({
      iso: now.toISO(),
      zone: ZONE,
    });
  });

  it('writes the rebooking edge', () => {
    expect(
      appointmentToDocument(appointment())['bookedFromAppointmentId'],
    ).toBe('appointment-1');
  });

  it('round-trips the booking instant', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(bookedAtFromDocument(document)?.toMillis()).toBe(now.toMillis());
  });

  it('reads a missing booking instant as null rather than inventing one', () => {
    expect(bookedAtFromDocument({})).toBeNull();
    expect(bookedAtFromDocument({ bookedAt: 'nonsense' })).toBeNull();
    expect(
      bookedAtFromDocument({ bookedAt: { iso: 'nope', zone: ZONE } }),
    ).toBeNull();
  });

  it('writes a per-seat outcome for every seat', () => {
    const document = appointmentToDocument(appointment());
    const seats = document['seats'] as readonly Record<string, unknown>[];
    expect(seats[0]?.['outcome']).toEqual({ kind: 'scheduled' });
  });
});

describe('seatOutcome persistence', () => {
  const END_MS = at('2026-06-01T10:30:00').toMillis();

  it('round-trips every arm', () => {
    const cases = [
      seatWorked(RESOLVED_AT_MS),
      seatNoShow(RESOLVED_AT_MS),
      seatCancelled(
        RESOLVED_AT_MS,
        'client',
        { kind: 'client_unwell' },
        windowOf(24),
      ),
      seatCancelled(
        RESOLVED_AT_MS,
        'staff',
        {
          kind: 'other',
          note: 'barber called in sick',
        },
        windowOf(0),
      ),
      // Older than the stamp: unknown, and it stays unknown.
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'unspecified' }, null),
    ];
    for (const outcome of cases) {
      expect(
        seatOutcomeFromDocument(
          seatOutcomeToDocument(outcome),
          CONFIRMED,
          END_MS,
        ),
      ).toEqual(outcome);
    }
  });

  it('reads a stored scheduled outcome as scheduled even on a finished visit', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'scheduled' }, COMPLETED, END_MS).kind,
    ).toBe('scheduled');
  });

  /**
   * The legacy path: rows written before outcomes existed have no `outcome`
   * field at all, and leaving them `scheduled` would make every historical
   * visit read as unfinished business.
   */
  it('derives a missing outcome from a terminal root status', () => {
    expect(seatOutcomeFromDocument(undefined, COMPLETED, END_MS)).toEqual({
      kind: 'worked',
      atMs: END_MS,
    });
    expect(
      seatOutcomeFromDocument(undefined, cancelled('shop closed'), END_MS),
    ).toEqual({
      kind: 'cancelled',
      atMs: END_MS,
      by: 'staff',
      reason: { kind: 'other', note: 'shop closed' },
      // A derived row is older than the stamp by construction.
      window: null,
    });
  });

  it('leaves a missing outcome scheduled while the visit is still open', () => {
    expect(seatOutcomeFromDocument(undefined, PENDING, END_MS)).toEqual({
      kind: 'scheduled',
    });
    expect(seatOutcomeFromDocument(undefined, undefined, END_MS)).toEqual({
      kind: 'scheduled',
    });
  });

  it('falls back to the derivation when the stored outcome is malformed', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'worked' }, COMPLETED, END_MS),
    ).toEqual({ kind: 'worked', atMs: END_MS });
    expect(
      seatOutcomeFromDocument({ kind: 'nonsense', atMs: 1 }, PENDING, END_MS)
        .kind,
    ).toBe('scheduled');
  });

  /*
   * The window in force when it was called off (2026-09-25): written as a
   * whole number of hours, read back as the same window, and — for every
   * cancellation stored before the stamp — absent, which reads as unknown.
   */
  it('writes the stamped window, and omits it rather than writing null when unknown', () => {
    expect(
      seatOutcomeToDocument(
        seatCancelled(
          RESOLVED_AT_MS,
          'client',
          { kind: 'unspecified' },
          windowOf(24),
        ),
      ),
    ).toEqual({
      kind: 'cancelled',
      atMs: RESOLVED_AT_MS,
      by: 'client',
      reason: { kind: 'unspecified' },
      windowHours: 24,
    });
    const legacy = seatOutcomeToDocument(
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'unspecified' }, null),
    );
    expect(Object.keys(legacy)).not.toContain('windowHours');
  });

  it('reads an absent or malformed stamp as unknown, never as a window', () => {
    const stored = (windowHours: unknown) =>
      seatOutcomeFromDocument(
        {
          kind: 'cancelled',
          atMs: RESOLVED_AT_MS,
          by: 'client',
          reason: { kind: 'unspecified' },
          ...(windowHours === undefined ? {} : { windowHours }),
        },
        CONFIRMED,
        END_MS,
      );
    const readBack = (windowHours: unknown) => {
      const outcome = stored(windowHours);
      return outcome.kind === 'cancelled' ? outcome.window : 'not cancelled';
    };
    expect(readBack(48)).toEqual(windowOf(48));
    expect(readBack(0)).toEqual(windowOf(0));
    for (const bad of [
      undefined,
      null,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      CANCELLATION_WINDOW_MAX_HOURS + 1,
      '24',
      {},
    ]) {
      expect(readBack(bad)).toBeNull();
    }
  });

  /*
   * ROUND 2 (2026-09-25): whatever a document holds under `windowHours`, the
   * read never throws, and it yields either a window the domain accepts or
   * unknown — never a number the stats would then have to second-guess.
   * The seat's other facts survive a malformed stamp untouched.
   */
  it('reads ANY stored stamp as a valid window or as unknown, and never throws', () => {
    const anyStored = fc.oneof(
      fc.integer(),
      fc.double(),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.dictionary(fc.string(), fc.integer()),
      fc.array(fc.integer()),
    );
    fc.assert(
      fc.property(anyStored, (windowHours) => {
        const outcome = seatOutcomeFromDocument(
          {
            kind: 'cancelled',
            atMs: RESOLVED_AT_MS,
            by: 'client',
            reason: { kind: 'client_unwell' },
            windowHours,
          },
          CONFIRMED,
          END_MS,
        );
        if (outcome.kind !== 'cancelled') throw new Error('not cancelled');
        expect(outcome.atMs).toBe(RESOLVED_AT_MS);
        expect(outcome.by).toBe('client');
        expect(outcome.reason).toEqual({ kind: 'client_unwell' });
        const accepted =
          typeof windowHours === 'number' &&
          CancellationWindow.create(windowHours).isSuccess();
        if (accepted) {
          expect(outcome.window).toBeInstanceOf(CancellationWindow);
          expect(outcome.window?.hours).toBe(
            windowHours === 0 ? 0 : windowHours,
          );
        } else {
          expect(outcome.window).toBeNull();
        }
      }),
    );
  });

  it('writes back a malformed stamp as absent — the row heals to unknown, not to a bad number', () => {
    for (const bad of [-1, 1.5, Number.NaN, '24']) {
      const reread = seatOutcomeFromDocument(
        {
          kind: 'cancelled',
          atMs: RESOLVED_AT_MS,
          by: 'staff',
          reason: { kind: 'client_changed_plans' },
          windowHours: bad,
        },
        CONFIRMED,
        END_MS,
      );
      expect(Object.keys(seatOutcomeToDocument(reread))).not.toContain(
        'windowHours',
      );
    }
  });

  it('round-trips a stored legacy cancellation byte for byte', () => {
    const legacy = {
      kind: 'cancelled',
      atMs: RESOLVED_AT_MS,
      by: 'client',
      reason: { kind: 'client_changed_plans' },
    };
    expect(
      seatOutcomeToDocument(seatOutcomeFromDocument(legacy, CONFIRMED, END_MS)),
    ).toEqual(legacy);
  });

  it('round-trips any stamped window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.option(
          fc.oneof(
            fc.nat({ max: 8_760 }),
            fc.nat({ max: CANCELLATION_WINDOW_MAX_HOURS }),
          ),
          { nil: null },
        ),
        fc.constantFrom<'client' | 'staff'>('client', 'staff'),
        (atMs, windowHours, by) => {
          const outcome = seatCancelled(
            atMs,
            by,
            { kind: 'client_changed_plans' },
            windowHours === null ? null : windowOf(windowHours),
          );
          expect(
            seatOutcomeFromDocument(
              seatOutcomeToDocument(outcome),
              CONFIRMED,
              END_MS,
            ),
          ).toEqual(outcome);
        },
      ),
    );
  });

  /**
   * Forward compatibility: a code this build does not know about must survive
   * a read rather than be silently flattened to a generic cancellation.
   */
  it('preserves an unrecognised cancellation code in the note', () => {
    const outcome = seatOutcomeFromDocument(
      {
        kind: 'cancelled',
        atMs: RESOLVED_AT_MS,
        by: 'client',
        reason: { kind: 'weather' },
      },
      CONFIRMED,
      END_MS,
    );
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind === 'cancelled') {
      expect(outcome.reason).toEqual({ kind: 'other', note: 'weather' });
    }
  });
});

describe('discount persistence', () => {
  const percent = (value: number): CouponValue => {
    const result = CouponValue.percentOff(value);
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  };

  const birthday = AppliedDiscount.of({
    id: 'grant:grant-1',
    source: 'grant',
    label: 'Рожден ден',
    value: percent(20),
    grantId: 'grant-1',
    appliedAt: at('2026-05-01T09:30:00'),
  });

  it('writes an empty list at full price, so absence stays distinguishable from age', () => {
    expect(appointmentToDocument(appointment())['discounts']).toEqual([]);
    // A row written before discounts existed has no field at all.
    expect(discountsFromDocument({})).toEqual([]);
  });

  it('round-trips a discount as a snapshot with its provenance', () => {
    const document = appointmentToDocument(
      appointment().withDiscounts([birthday]),
    );
    expect(document['discounts']).toEqual([
      {
        id: 'grant:grant-1',
        source: 'grant',
        label: 'Рожден ден',
        value: { kind: 'percent_off', percent: 20 },
        grantId: 'grant-1',
        code: null,
        appliedAt: { iso: birthday.appliedAt.toISO(), zone: ZONE },
        combinability: 'stackable',
      },
    ]);
    const [read] = discountsFromDocument(document);
    expect(read?.equals(birthday)).toBe(true);
    expect(read?.label).toBe('Рожден ден');
    expect(read?.appliedAt.toMillis()).toBe(birthday.appliedAt.toMillis());
  });

  it('writes a fixed amount in minor units beside its currency, and reads it back as money', () => {
    const five = Money.fromMinorUnitsAndCode(500, 'EUR');
    if (five.isFailure()) throw new Error('bad fixture');
    const fixed = CouponValue.fixedAmount(five.value);
    if (fixed.isFailure()) throw new Error('bad fixture');
    const manual = AppliedDiscount.of({
      id: 'manual',
      source: 'manual',
      label: 'manual',
      value: fixed.value,
      appliedAt: at('2026-05-01T09:30:00'),
    });
    const document = appointmentToDocument(
      appointment().withDiscounts([manual]),
    );
    const [written] = document['discounts'] as Record<string, unknown>[];
    expect(written?.['value']).toEqual({
      kind: 'fixed_amount',
      amountMinorUnits: 500,
      currencyCode: 'EUR',
    });
    const value = couponValueFromDocument(written?.['value']);
    expect(value?.kind).toBe('fixed_amount');
    if (value?.kind === 'fixed_amount') {
      expect(value.amount.toMinorUnits()).toBe(500);
    }
  });

  it('drops an entry it cannot read rather than failing the appointment', () => {
    const good = {
      id: 'code:coupon-1',
      source: 'code',
      label: 'Първо посещение',
      value: { kind: 'percent_off', percent: 10 },
      grantId: null,
      code: 'FIRST10',
      appliedAt: { iso: at('2026-05-01T09:30:00').toISO(), zone: ZONE },
    };
    const read = discountsFromDocument({
      discounts: [
        good,
        { ...good, id: '' },
        { ...good, source: 'wishful' },
        { ...good, value: { kind: 'percent_off', percent: 140 } },
        { ...good, appliedAt: 'yesterday' },
        'nonsense',
      ],
    });
    expect(read).toHaveLength(1);
    expect(read[0]?.code).toBe('FIRST10');
    expect(read[0]?.source).toBe('code');
  });
});

describe('voucher redemption persistence', () => {
  const eur = (minor: number) => {
    const money = Money.fromMinorUnitsAndCode(minor, 'EUR');
    if (money.isFailure()) throw new Error('bad fixture');
    return money.value;
  };
  const redemption = VoucherRedemption.of({
    voucherId: 'v1',
    code: 'GIFT2025',
    amount: eur(1000),
    balanceAfter: eur(1500),
    appliedAt: at('2026-05-01T09:30:00'),
  });

  it('writes an empty list when nothing was paid ahead, and reads absence as none', () => {
    expect(appointmentToDocument(appointment())['voucherRedemptions']).toEqual(
      [],
    );
    expect(voucherRedemptionsFromDocument({})).toEqual([]);
  });

  it('round-trips a draw-down with the balance it left, live or reversed', () => {
    const reversed = redemption.reversed(at('2026-05-02T09:30:00'));
    const document = appointmentToDocument(
      appointment().withVoucherRedemptions([redemption, reversed]),
    );
    expect(document['voucherRedemptions']).toEqual([
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountMinorUnits: 1000,
        balanceAfterMinorUnits: 1500,
        currencyCode: 'EUR',
        appliedAt: { iso: redemption.appliedAt.toISO(), zone: ZONE },
        reversedAt: null,
      },
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountMinorUnits: 1000,
        balanceAfterMinorUnits: 1500,
        currencyCode: 'EUR',
        appliedAt: { iso: redemption.appliedAt.toISO(), zone: ZONE },
        reversedAt: { iso: reversed.reversedAt?.toISO(), zone: ZONE },
      },
    ]);
    const read = voucherRedemptionsFromDocument(document);
    expect(read).toHaveLength(2);
    expect(read[0]?.live).toBe(true);
    expect(read[0]?.amount.toMinorUnits()).toBe(1000);
    expect(read[0]?.balanceAfter.toMinorUnits()).toBe(1500);
    expect(read[1]?.live).toBe(false);
  });

  it('reads an exclusive discount back as exclusive', () => {
    const exclusive = AppliedDiscount.of({
      id: 'grant:g',
      source: 'grant',
      label: 'Рожден ден',
      value: (() => {
        const r = CouponValue.percentOff(20);
        if (r.isFailure()) throw new Error('bad fixture');
        return r.value;
      })(),
      grantId: 'g',
      appliedAt: at('2026-05-01T09:30:00'),
      combinability: CouponCombinability.exclusive(),
    });
    const document = appointmentToDocument(
      appointment().withDiscounts([exclusive]),
    );
    expect(
      (document['discounts'] as Record<string, unknown>[])[0]?.[
        'combinability'
      ],
    ).toBe('exclusive');
    expect(discountsFromDocument(document)[0]?.exclusive).toBe(true);
  });

  it('drops a draw-down it cannot read rather than failing the appointment', () => {
    const read = voucherRedemptionsFromDocument({
      voucherRedemptions: [
        {
          voucherId: '',
          code: 'X',
          amountMinorUnits: 1,
          currencyCode: 'EUR',
          appliedAt: { iso: at('2026-05-01T09:30:00').toISO(), zone: ZONE },
        },
        {
          voucherId: 'v',
          code: 'GIFT5',
          amountMinorUnits: 'five',
          currencyCode: 'EUR',
        },
        'nonsense',
      ],
    });
    expect(read).toEqual([]);
  });
});

describe('persistedChairTimesOf — the chairs a stored visit holds, read off its seats', () => {
  /** A visit of 1–3 people, each with their own barber, pads and start. */
  const anyVisit = fc
    .array(
      fc.record({
        offsetMinutes: fc.integer({ min: 0, max: 8 * 60 }),
        durationMinutes: fc.integer({ min: 5, max: 120 }),
        setupMinutes: fc.integer({ min: 0, max: 30 }),
        cleanupMinutes: fc.integer({ min: 0, max: 30 }),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .map((shapes) => {
      const price = Money.fromMinorUnitsAndCode(1500, 'EUR');
      if (price.isFailure()) throw new Error('bad fixture');
      const seats = shapes.map((shape, index) => {
        const sold = ServiceTerms.create(price.value, shape.durationMinutes, {
          setupMinutes: shape.setupMinutes,
          cleanupMinutes: shape.cleanupMinutes,
        });
        if (sold.isFailure()) throw new Error('bad fixture');
        return Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            UserId.generate(),
            index === 0 ? 'self' : 'companion',
          ),
          serviceId: ServiceId.generate(),
          variantId: null,
          barberId: BarberId.generate(),
          terms: sold.value,
          startsAt: at('2026-06-01T09:00:00').plusMinutes(shape.offsetMinutes),
        });
      });
      const result = Appointment.create({
        id: 'appointment-2',
        locationId: LocationId.generate().toString(),
        seats,
        now: at('2026-05-01T09:00:00'),
      });
      if (result.isFailure()) throw new Error('bad fixture');
      return result.value;
    });

  // The server hands a moved visit's chairs back from the aggregate when it
  // reads the document, and from the stored seats when it cannot. The two
  // must be the same chairs, or a legacy visit would release a different
  // time from the one its grid offered around.
  it('reads exactly the chairs the aggregate does, seat by seat', () => {
    fc.assert(
      fc.property(anyVisit, (visit) => {
        expect(persistedChairTimesOf(appointmentToDocument(visit))).toEqual(
          visit.chairTimes(),
        );
      }),
    );
  });

  // …and the same geometry the busy projection holds for the visit, since
  // the rebuild trigger projects `busyContributionsOf`.
  it('holds the chairs the busy projection holds for the visit', () => {
    fc.assert(
      fc.property(anyVisit, (visit) => {
        const document = appointmentToDocument(visit);
        const projected = busyContributionsOf(document);
        for (const chair of persistedChairTimesOf(document)) {
          const seat = visit.seats.find((candidate) =>
            candidate.barberId.equals(chair.barberId),
          );
          if (!seat) throw new Error('a chair with no seat');
          const key = busyDocumentId(
            chair.barberId.value,
            seat.slot.start.toISODate(),
          );
          expect(projected.get(key)?.intervals).toContainEqual(chair.occupied);
        }
      }),
    );
  });

  it('still reads a visit the aggregate refuses — its chairs are in the projection all the same', () => {
    const visit = appointment();
    // A legacy document with no status: the aggregate cannot be rebuilt.
    const legacy = { ...appointmentToDocument(visit), status: null };

    expect(appointmentFromDocument('appointment-2', legacy).isFailure()).toBe(
      true,
    );
    expect(persistedChairTimesOf(legacy)).toEqual(visit.chairTimes());
  });

  it('holds no chair for a seat that names no barber or has no readable slot', () => {
    const document = appointmentToDocument(appointment());
    const [stored] = document['seats'] as Record<string, unknown>[];

    expect(
      persistedChairTimesOf({
        ...document,
        seats: [
          { ...stored, barberId: '' },
          {
            ...stored,
            slot: { startIso: 'never', endIso: 'never', zone: ZONE },
          },
        ],
      }),
    ).toEqual([]);
    expect(persistedChairTimesOf({ ...document, seats: 'nope' })).toEqual([]);
  });
});

/*
 * The projection reads the RAW stored geometry — the sold slot's own instants
 * and the pads as stored — so its bytes never move with the wall clock: a pad
 * is not clamped at the day's edge, a fraction of a minute is a fraction, and
 * a seat sold past midnight (F-6 refuses one; none is stored) projects the
 * chair it holds instead of throwing the rebuild over.
 */
describe('busyContributionsOf — the raw stored geometry, byte for byte', () => {
  const doc = (
    startIso: string,
    endIso: string,
    setupMinutes = 0,
    cleanupMinutes = 0,
  ) => ({
    seats: [
      {
        id: 's1',
        serviceId: 'svc',
        barberId: 'ivan',
        slot: { startIso, endIso, zone: ZONE },
        terms: { setupMinutes, cleanupMinutes },
      },
    ],
  });
  const spans = (document: Record<string, unknown>) =>
    [...busyContributionsOf(document)].map(([key, entry]) => [
      key,
      entry.intervals.map(
        (interval) =>
          `${new Date(interval.startMs).toISOString()}..${new Date(interval.endMs).toISOString()}`,
      ),
    ]);

  it('projects a seat sold past midnight onto its start day, unclipped', () => {
    const document = doc(
      '2026-08-03T23:30:00.000+03:00',
      '2026-08-04T00:30:00.000+03:00',
    );
    expect(spans(document)).toEqual([
      [
        'ivan__2026-08-03',
        ['2026-08-03T20:30:00.000Z..2026-08-03T21:30:00.000Z'],
      ],
    ]);
    expect(persistedChairTimesOf(document)).toHaveLength(1);
  });

  it('lays the pads past the day’s edges as stored, never clamped at midnight', () => {
    expect(
      spans(
        doc(
          '2026-08-03T23:30:00.000+03:00',
          '2026-08-03T23:50:00.000+03:00',
          0,
          20,
        ),
      ),
    ).toEqual([
      [
        'ivan__2026-08-03',
        ['2026-08-03T20:30:00.000Z..2026-08-03T21:10:00.000Z'],
      ],
    ]);
    expect(
      spans(
        doc(
          '2026-08-03T00:05:00.000+03:00',
          '2026-08-03T00:35:00.000+03:00',
          10,
          0,
        ),
      ),
    ).toEqual([
      [
        'ivan__2026-08-03',
        ['2026-08-02T20:55:00.000Z..2026-08-02T21:35:00.000Z'],
      ],
    ]);
  });

  it('projects a slot that is no whole number of minutes, as stored', () => {
    expect(
      spans(
        doc('2026-08-03T10:00:00.000+03:00', '2026-08-03T10:30:30.000+03:00'),
      ),
    ).toEqual([
      [
        'ivan__2026-08-03',
        ['2026-08-03T07:00:00.000Z..2026-08-03T07:30:30.000Z'],
      ],
    ]);
  });
});

/*
 * THE REVISION A COPY WAS READ AT (round 6). The one reader that feeds the
 * staff dashboard reads through this mapper, and every staff intent drawn
 * from its copy claims `Appointment.revision` as `expectedVersion`. Left
 * unread, every copy said `null`, every save claimed nothing, and the
 * server's stale-screen guard never refused an older sheet.
 */
describe('appointmentFromDocument — the revision the copy was read at', () => {
  function read(document: Record<string, unknown>): Appointment {
    const result = appointmentFromDocument('appointment-2', document);
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  }

  it('reads the stored counter', () => {
    const document = { ...appointmentToDocument(appointment()), revision: 4 };

    expect(read(document).revision).toBe(4);
  });

  it('reads a row written before staff editing as 0 — what the server holds it at', () => {
    const document = appointmentToDocument(appointment());
    expect(document).not.toHaveProperty('revision');

    // Not `null`: a claim of nothing is never refused, and `0` is exactly
    // what the server's check (`revisionOf`) reads the same row as.
    expect(read(document).revision).toBe(0);
    expect(read(document).revision).toBe(revisionOf(document));
  });

  it('claims exactly what the server’s stale check reads, for any counter', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), (counter) => {
        const document = {
          ...appointmentToDocument(appointment()),
          revision: counter,
        };
        expect(read(document).revision).toBe(revisionOf(document));
      }),
    );
  });
});

/*
 * THE PAIRS A STAFF SAVE BROKE, REMEMBERED FOR ITS UNDO (round 6). One
 * field, stamped with the revision of the save that broke them, honoured by
 * the write that follows that save and by no other.
 */
describe('stoodSeatPairs — the memory an undo stands by', () => {
  const memory = {
    revision: 4,
    pairs: [{ seatId: 'seat-1', otherSeatId: 'seat-2' }],
  };

  it('reads the pairs and the revision of the save that broke them', () => {
    expect(
      stoodSeatPairsFromDocument({ [STOOD_SEAT_PAIRS_FIELD]: memory }),
    ).toEqual({
      revision: 4,
      pairs: [['seat-1', 'seat-2']],
    });
  });

  it('costs a malformed pair only that pair, and reads no pairs as no memory', () => {
    expect(
      stoodSeatPairsFromDocument({
        stoodSeatPairs: {
          revision: 4,
          pairs: [
            { seatId: 'seat-1', otherSeatId: 'seat-2' },
            { seatId: '', otherSeatId: 'seat-2' },
            { seatId: 'seat-1' },
            'seat-3',
            null,
          ],
        },
      }),
    ).toEqual({ revision: 4, pairs: [['seat-1', 'seat-2']] });
    expect(
      stoodSeatPairsFromDocument({
        stoodSeatPairs: { revision: 4, pairs: [] },
      }),
    ).toBeNull();
    expect(
      stoodSeatPairsFromDocument({
        stoodSeatPairs: { revision: 'four', pairs: [] },
      }),
    ).toBeNull();
    expect(stoodSeatPairsFromDocument({})).toBeNull();
  });

  it('is live only while the visit is at the revision the breaking save stamped', () => {
    expect(liveStoodSeatPairs({ revision: 4, stoodSeatPairs: memory })).toEqual(
      [['seat-1', 'seat-2']],
    );
    // Anything written since moved the revision on: the memory is inert.
    expect(liveStoodSeatPairs({ revision: 5, stoodSeatPairs: memory })).toEqual(
      [],
    );
    expect(liveStoodSeatPairs({ revision: 4 })).toEqual([]);
  });

  it('writes the memory a save leaves, or drops the field — never carries an older one', () => {
    const fields = { revision: 5, stoodSeatPairs: memory, staffNote: 'x' };

    expect(
      withStoodSeatPairs(fields, {
        revision: 5,
        pairs: [['seat-1', 'seat-3']],
      }),
    ).toEqual({
      revision: 5,
      staffNote: 'x',
      stoodSeatPairs: {
        revision: 5,
        pairs: [{ seatId: 'seat-1', otherSeatId: 'seat-3' }],
      },
    });
    expect(withStoodSeatPairs(fields, null)).toEqual({
      revision: 5,
      staffNote: 'x',
    });
    expect(withStoodSeatPairs(fields, { revision: 5, pairs: [] })).toEqual({
      revision: 5,
      staffNote: 'x',
    });
  });

  it('is not the mapper’s: a rewrite carries it forward, under its own revision', () => {
    const document = {
      ...appointmentToDocument(appointment()),
      revision: 4,
      stoodSeatPairs: memory,
    };

    expect(preservedAppointmentFields(document)).toMatchObject({
      stoodSeatPairs: memory,
    });
  });

  it('round-trips any pairs it writes (property)', () => {
    const id = fc.stringMatching(/^seat-[a-z0-9]{1,6}$/);
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),
        fc.array(fc.tuple(id, id), { minLength: 1, maxLength: 4 }),
        (revision, pairs) => {
          const written = withStoodSeatPairs({ revision }, { revision, pairs });
          expect(stoodSeatPairsFromDocument(written)).toEqual({
            revision,
            pairs,
          });
          expect(liveStoodSeatPairs(written)).toEqual(pairs);
        },
      ),
    );
  });
});
