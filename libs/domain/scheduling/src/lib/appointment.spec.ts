import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Appointment } from './appointment';
import {
  AppointmentStatus,
  COMPLETED,
  CONFIRMED,
  NO_SHOW,
  PENDING,
  cancelled,
} from './appointment-status';
import { BookingContact } from './booking-contact';
import { SeatId } from './ids';
import { Seat, SeatSubject } from './seat';
import { seatCancelled, seatNoShow, seatWorked } from './seat-outcome';

const zone = 'Europe/Sofia';

/** The instant a lifecycle verb is taken. Fixed so outcomes are comparable. */
const RESOLVED_AT_MS = Date.UTC(2026, 7, 5, 9, 0, 0);

function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

interface SeatOverrides {
  readonly relationship?: 'self' | 'companion';
  readonly barberId?: BarberId;
  readonly startIso?: string;
  readonly priceMinorUnits?: number;
  /** The seat's ONE statement of its own length. */
  readonly durationMinutes?: number;
  readonly currencyCode?: string;
}

function seat(overrides: SeatOverrides = {}): Seat {
  const price = Money.fromMinorUnitsAndCode(
    overrides.priceMinorUnits ?? 1500,
    overrides.currencyCode ?? 'EUR',
  );
  if (price.isFailure()) throw new Error('bad fixture');
  const seatTerms = ServiceTerms.create(
    price.value,
    overrides.durationMinutes ?? 30,
  );
  if (seatTerms.isFailure()) throw new Error('bad fixture');

  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(
      UserId.generate(),
      overrides.relationship ?? 'self',
    ),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: overrides.barberId ?? BarberId.generate(),
    terms: seatTerms.value,
    startsAt: at(overrides.startIso ?? '2026-06-01T10:00:00'),
  });
}

function oneSeat(): Seat[] {
  return [seat()];
}

function reconstituteWithStatus(status: AppointmentStatus): Appointment {
  const result = Appointment.reconstitute({
    id: 'appointment-1',
    locationId: LocationId.generate().toString(),
    seats: oneSeat(),
    status,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('Appointment.create', () => {
  it('creates a pending appointment for a future slot', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status.kind).toBe('pending');
    }
  });

  it('rejects scheduling into the past', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now: at('2026-07-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty seats array', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: [],
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects more than one "self" seat', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: [...oneSeat(), ...oneSeat()],
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = Appointment.create({
      id: '',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });
});

describe('Appointment — the arrangements a party may take', () => {
  const IVAN = BarberId.generate();
  const NIKO = BarberId.generate();

  function build(seats: Seat[]) {
    return Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats,
      now: at('2026-05-01T00:00:00'),
    });
  }

  it('accepts a PARALLEL party — same start, different barbers', () => {
    const result = build([
      seat({
        barberId: IVAN,
        startIso: '2026-06-01T10:00:00',
        durationMinutes: 45,
      }),
      seat({
        relationship: 'companion',
        barberId: NIKO,
        startIso: '2026-06-01T10:00:00',
      }),
    ]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      // The envelope is the LONGEST seat, not the sum — they were served at once.
      expect(result.value.timeSlot.start.toISO()).toContain('10:00');
      expect(result.value.timeSlot.end.toISO()).toContain('10:45');
      expect(result.value.barberIds()).toHaveLength(2);
    }
  });

  it('accepts a SEQUENTIAL party with ONE barber — father and son, back to back', () => {
    // The case a "no barber twice" rule would have wrongly rejected. The
    // invariant is about collision, not repetition.
    const result = build([
      seat({
        barberId: IVAN,
        durationMinutes: 45,
        startIso: '2026-06-01T10:00:00',
      }),
      seat({
        relationship: 'companion',
        barberId: IVAN,
        durationMinutes: 30,
        startIso: '2026-06-01T10:45:00',
      }),
    ]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      // The envelope spans the whole 75-minute chain, but the longest
      // single seat is still 45m — the distinction a "sum vs max" duration
      // field would have collapsed.
      expect(result.value.timeSlot.end.toISO()).toContain('11:15');
      expect(result.value.longestSeatMinutes()).toBe(45);
      expect(result.value.barberIds()).toHaveLength(1);
    }
  });

  it('rejects one barber in two chairs at once', () => {
    const result = build([
      seat({
        barberId: IVAN,
        startIso: '2026-06-01T10:00:00',
        durationMinutes: 45,
      }),
      seat({
        relationship: 'companion',
        barberId: IVAN,
        startIso: '2026-06-01T10:30:00',
      }),
    ]);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.map((e) => e.code)).toContain(
        'scheduling.appointment.barber_double_booked',
      );
    }
  });

  it('names each double-booked barber once, not once per colliding pair', () => {
    const result = build([
      seat({
        barberId: IVAN,
        startIso: '2026-06-01T10:00:00',
        durationMinutes: 60,
      }),
      seat({
        relationship: 'companion',
        barberId: IVAN,
        startIso: '2026-06-01T10:10:00',
      }),
      seat({
        relationship: 'companion',
        barberId: IVAN,
        startIso: '2026-06-01T10:20:00',
      }),
    ]);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      const doubleBooked = result.error.filter(
        (e) => e.code === 'scheduling.appointment.barber_double_booked',
      );
      expect(doubleBooked).toHaveLength(1);
    }
  });

  it('takes the future-start check from the EARLIEST seat', () => {
    // A sequential party whose first seat is in the past must be rejected
    // even though its later seats are not.
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: [
        seat({ startIso: '2026-06-01T10:00:00', durationMinutes: 30 }),
        seat({
          relationship: 'companion',
          startIso: '2026-06-01T14:00:00',
        }),
      ],
      now: at('2026-06-01T12:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('sums the seats’ own snapshotted prices', () => {
    const result = build([
      seat({ priceMinorUnits: 1450 }),
      seat({
        relationship: 'companion',
        barberId: NIKO,
        priceMinorUnits: 1000,
      }),
    ]);
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.subtotal().toMinorUnits()).toBe(2450);
  });

  it('rejects seats priced in two currencies', () => {
    const result = build([
      seat({ currencyCode: 'EUR' }),
      seat({ relationship: 'companion', barberId: NIKO, currencyCode: 'USD' }),
    ]);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.map((e) => e.code)).toContain(
        'scheduling.appointment.mixed_currency',
      );
    }
  });
});

describe('Appointment.reconstitute — past appointments are legitimate', () => {
  it('allows a past-dated slot when rebuilding from persistence', () => {
    const appointment = reconstituteWithStatus(COMPLETED);
    expect(appointment.status.kind).toBe('completed');
  });
});

describe('Appointment status transition matrix (goal condition item)', () => {
  const LEGAL: Record<string, readonly string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled', 'no_show'],
    completed: [],
    cancelled: [],
    no_show: ['confirmed'],
  };

  const STARTING_STATUSES: Record<string, AppointmentStatus> = {
    pending: PENDING,
    confirmed: CONFIRMED,
    completed: COMPLETED,
    cancelled: cancelled('customer request'),
    no_show: NO_SHOW,
  };

  const TRANSITIONS: Record<
    string,
    (appointment: Appointment) => { isSuccess(): boolean }
  > = {
    confirmed: (a) => a.confirm(),
    completed: (a) => a.complete(RESOLVED_AT_MS),
    cancelled: (a) => a.cancel('customer request', RESOLVED_AT_MS),
    no_show: (a) => a.markNoShow(RESOLVED_AT_MS),
  };

  for (const [from, statusFixture] of Object.entries(STARTING_STATUSES)) {
    for (const to of Object.keys(TRANSITIONS)) {
      const shouldSucceed = (LEGAL[from] ?? []).includes(to);
      it(`${from} → ${to} is ${shouldSucceed ? 'legal' : 'illegal'}`, () => {
        const appointment = reconstituteWithStatus(statusFixture);
        const result = TRANSITIONS[to]!(appointment);
        expect(result.isSuccess()).toBe(shouldSucceed);
      });
    }
  }
});

describe('Appointment.cancel', () => {
  it('rejects an empty cancellation reason', () => {
    const appointment = reconstituteWithStatus(PENDING);
    const result = appointment.cancel('   ', RESOLVED_AT_MS);
    expect(result.isFailure()).toBe(true);
  });

  it('carries the reason structurally on the cancelled status', () => {
    const appointment = reconstituteWithStatus(PENDING);
    const result = appointment.cancel('no longer needed', RESOLVED_AT_MS);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.status.kind === 'cancelled') {
      expect(result.value.status.reason).toBe('no longer needed');
    }
  });
});

// ── The write-time captures ────────────────────────────────────────────────

describe('Appointment booking metadata', () => {
  it('stamps bookedAt from the same instant it validated the start against', () => {
    const now = at('2026-05-01T00:00:00');
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.bookedAt?.toMillis()).toBe(now.toMillis());
    }
  });

  it('reports booking lead time in minutes', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      // The fixture seat starts 2026-06-01T10:00 — one hour after this.
      seats: [seat({ startIso: '2026-06-01T10:00:00' })],
      now: at('2026-06-01T09:00:00'),
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.bookingLeadTimeMinutes()).toBe(60);
    }
  });

  it('has no lead time for an appointment written before bookedAt existed', () => {
    expect(reconstituteWithStatus(PENDING).bookingLeadTimeMinutes()).toBeNull();
  });

  it('carries the rebooking link', () => {
    const result = Appointment.create({
      id: 'appointment-2',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now: at('2026-05-01T00:00:00'),
      bookedFromAppointmentId: 'appointment-1',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.bookedFrom?.value).toBe('appointment-1');
    }
  });

  it('drops an unparseable rebooking link rather than refusing the booking', () => {
    const result = Appointment.create({
      id: 'appointment-2',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      now: at('2026-05-01T00:00:00'),
      bookedFromAppointmentId: '   ',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.bookedFrom).toBeNull();
    }
  });
});

describe('Appointment seat outcomes', () => {
  /** A party of two on different barbers, confirmed and ready to be resolved. */
  function party(): Appointment {
    const result = Appointment.reconstitute({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: [
        seat({ startIso: '2026-06-01T10:00:00' }),
        seat({ relationship: 'companion', startIso: '2026-06-01T10:00:00' }),
      ],
      status: CONFIRMED,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  }

  it('starts every seat scheduled', () => {
    expect(party().seats.every((s) => s.outcome.kind === 'scheduled')).toBe(
      true,
    );
    expect(party().openSeats()).toHaveLength(2);
  });

  it('keeps the root unchanged while any seat is still open', () => {
    const appointment = party();
    const marked = appointment.markSeatOutcome(
      appointment.seats[0]!.id,
      seatWorked(RESOLVED_AT_MS),
    );
    expect(marked.isSuccess()).toBe(true);
    if (marked.isSuccess()) {
      expect(marked.value.status.kind).toBe('confirmed');
      expect(marked.value.openSeats()).toHaveLength(1);
    }
  });

  /**
   * THE case the whole change exists for: two served, one absent. Before
   * per-seat outcomes this party had no representable state — `no_show` at the
   * root erased the completed work, `completed` erased the no-show.
   */
  it('summarises a mixed party as completed while keeping the no-show visible', () => {
    const appointment = party();
    const first = appointment.markSeatOutcome(
      appointment.seats[0]!.id,
      seatWorked(RESOLVED_AT_MS),
    );
    expect(first.isSuccess()).toBe(true);
    if (!first.isSuccess()) return;

    const second = first.value.markSeatOutcome(
      first.value.seats[1]!.id,
      seatNoShow(RESOLVED_AT_MS),
    );
    expect(second.isSuccess()).toBe(true);
    if (!second.isSuccess()) return;

    expect(second.value.status.kind).toBe('completed');
    expect(second.value.seats[0]!.outcome.kind).toBe('worked');
    expect(second.value.seats[1]!.outcome.kind).toBe('no_show');
  });

  it('summarises an all-cancelled party as cancelled, with groupable codes', () => {
    const appointment = party();
    const first = appointment.markSeatOutcome(
      appointment.seats[0]!.id,
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'client_unwell' }),
    );
    if (!first.isSuccess()) throw new Error('unexpected failure');
    const second = first.value.markSeatOutcome(
      first.value.seats[1]!.id,
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'client_changed_plans' }),
    );
    expect(second.isSuccess()).toBe(true);
    if (second.isSuccess() && second.value.status.kind === 'cancelled') {
      expect(second.value.status.reason).toBe(
        'client_changed_plans+client_unwell',
      );
    }
  });

  it('refuses a seat it does not hold', () => {
    const result = party().markSeatOutcome(
      SeatId.generate(),
      seatWorked(RESOLVED_AT_MS),
    );
    expect(result.isFailure()).toBe(true);
  });

  it('refuses to re-resolve a seat', () => {
    const appointment = party();
    const first = appointment.markSeatOutcome(
      appointment.seats[0]!.id,
      seatWorked(RESOLVED_AT_MS),
    );
    if (!first.isSuccess()) throw new Error('unexpected failure');
    const again = first.value.markSeatOutcome(
      first.value.seats[0]!.id,
      seatNoShow(RESOLVED_AT_MS),
    );
    expect(again.isFailure()).toBe(true);
  });

  it('refuses to resolve a seat on a terminal appointment', () => {
    const appointment = party();
    const done = appointment.cancel('shop closed', RESOLVED_AT_MS);
    if (!done.isSuccess()) throw new Error('unexpected failure');
    const result = done.value.markSeatOutcome(
      done.value.seats[0]!.id,
      seatWorked(RESOLVED_AT_MS),
    );
    expect(result.isFailure()).toBe(true);
  });

  it('fans a party-level complete out to every open seat', () => {
    const result = party().complete(RESOLVED_AT_MS);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.seats.every((s) => s.outcome.kind === 'worked')).toBe(
        true,
      );
    }
  });

  it('leaves an already-resolved seat alone when the party completes', () => {
    const appointment = party();
    const first = appointment.markSeatOutcome(
      appointment.seats[0]!.id,
      seatNoShow(RESOLVED_AT_MS),
    );
    if (!first.isSuccess()) throw new Error('unexpected failure');
    const done = first.value.complete(RESOLVED_AT_MS + 60_000);
    expect(done.isSuccess()).toBe(true);
    if (done.isSuccess()) {
      expect(done.value.seats[0]!.outcome.kind).toBe('no_show');
      expect(done.value.seats[1]!.outcome.kind).toBe('worked');
    }
  });

  it('reopens a no-show and lifts the stamp off the seats it wrote', () => {
    // The correction edge. Without the seat sweep this would leave a booking
    // saying "confirmed" over seats still saying "no_show" — a worse state
    // than the one being undone, and one that poisons every seat count.
    const marked = reconstituteWithStatus(CONFIRMED).markNoShow(RESOLVED_AT_MS);
    if (!marked.isSuccess()) throw new Error('unexpected failure');
    expect(marked.value.seats[0]!.outcome.kind).toBe('no_show');

    const reopened = marked.value.reopenNoShow();
    expect(reopened.isSuccess()).toBe(true);
    if (reopened.isSuccess()) {
      expect(reopened.value.status.kind).toBe('confirmed');
      for (const seat of reopened.value.seats) {
        expect(seat.outcome.kind).toBe('scheduled');
      }
    }
  });

  it('reopening leaves a seat that was resolved on its own alone', () => {
    // Same rule `markNoShow` honours on the way in: the guest who cancelled
    // while the other two waited keeps what they were given.
    const base = party();
    const withSeatCancelled = base.markSeatOutcome(
      base.seats[0]!.id,
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'client_unwell' }),
    );
    if (!withSeatCancelled.isSuccess()) throw new Error('unexpected failure');
    const marked = withSeatCancelled.value.markNoShow(RESOLVED_AT_MS + 1_000);
    if (!marked.isSuccess()) throw new Error('unexpected failure');

    const reopened = marked.value.reopenNoShow();
    expect(reopened.isSuccess()).toBe(true);
    if (reopened.isSuccess()) {
      expect(reopened.value.seats[0]!.outcome.kind).toBe('cancelled');
      expect(reopened.value.seats[1]!.outcome.kind).toBe('scheduled');
    }
  });

  it('refuses to reopen anything that is not a no-show', () => {
    for (const status of [PENDING, CONFIRMED, COMPLETED]) {
      const result = reconstituteWithStatus(status).reopenNoShow();
      expect(result.isSuccess()).toBe(false);
    }
  });

  /*
   * THE SAME-DAY CORRECTION EDGE (owner ruling 2026-09-08). Terminal stays
   * terminal for the graph; this is the one narrow way back, and it closes
   * at midnight.
   */
  it('reopens a completed visit on its own day, every seat back to scheduled', () => {
    const done = reconstituteWithStatus(PENDING).confirm();
    if (!done.isSuccess()) throw new Error('unexpected failure');
    const completed = done.value.complete(RESOLVED_AT_MS);
    if (!completed.isSuccess()) throw new Error('unexpected failure');
    expect(completed.value.seats[0]!.outcome.kind).toBe('worked');

    const reopened = completed.value.reopenSettled(
      completed.value.timeSlot.end,
    );
    expect(reopened.isSuccess()).toBe(true);
    if (reopened.isSuccess()) {
      expect(reopened.value.status.kind).toBe('confirmed');
      expect(reopened.value.seats[0]!.outcome.kind).toBe('scheduled');
    }
  });

  it('reinstates a cancelled visit on its own day', () => {
    const cancelled = reconstituteWithStatus(CONFIRMED).cancel(
      'mis-tap',
      RESOLVED_AT_MS,
    );
    if (!cancelled.isSuccess()) throw new Error('unexpected failure');
    const back = cancelled.value.reopenSettled(cancelled.value.timeSlot.end);
    expect(back.isSuccess()).toBe(true);
    if (back.isSuccess()) {
      expect(back.value.status.kind).toBe('confirmed');
      expect(back.value.seats[0]!.outcome.kind).toBe('scheduled');
    }
  });

  it('refuses to reopen a settled visit the next day, or a live one at all', () => {
    const completed = reconstituteWithStatus(COMPLETED);
    const nextDay = completed.timeSlot.end.plusMinutes(24 * 60);
    const late = completed.reopenSettled(nextDay);
    expect(late.isSuccess()).toBe(false);
    if (late.isFailure()) {
      expect(late.error.code).toBe(
        'scheduling.appointment.reopen_window_closed',
      );
    }
    expect(
      reconstituteWithStatus(CONFIRMED)
        .reopenSettled(reconstituteWithStatus(CONFIRMED).timeSlot.end)
        .isSuccess(),
    ).toBe(false);
  });

  it('takes an arrival stamp back, and only while the visit is live', () => {
    const live = reconstituteWithStatus(CONFIRMED);
    const arrived = live.markArrived(live.timeSlot.start);
    if (!arrived.isSuccess()) throw new Error('unexpected failure');
    expect(arrived.value.arrivedAt).not.toBeNull();

    const cleared = arrived.value.clearArrival();
    expect(cleared.isSuccess()).toBe(true);
    if (cleared.isSuccess()) expect(cleared.value.arrivedAt).toBeNull();
    // Idempotent: clearing what was never set is a no-op.
    expect(live.clearArrival().isSuccess()).toBe(true);
    expect(reconstituteWithStatus(COMPLETED).clearArrival().isSuccess()).toBe(
      false,
    );
  });

  it('confirming resolves nothing — it is about the booking, not the work', () => {
    const result = reconstituteWithStatus(PENDING).confirm();
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.seats[0]!.outcome.kind).toBe('scheduled');
    }
  });

  /**
   * Regression: `transition` built a four-argument `Appointment`, so `contact`
   * fell off the end and every confirm/complete/cancel silently erased the
   * number the shop was given.
   */
  it('keeps the contact snapshot across a transition', () => {
    const contact = BookingContact.create({
      name: 'Ivan Petrov',
      phone: '+359888123456',
      email: null,
      note: null,
    });
    if (contact.isFailure()) throw new Error('bad fixture');
    const built = Appointment.reconstitute({
      id: 'appointment-1',
      locationId: LocationId.generate().toString(),
      seats: oneSeat(),
      status: PENDING,
      contact: contact.value,
    });
    if (built.isFailure()) throw new Error('bad fixture');

    const confirmed = built.value.confirm();
    expect(confirmed.isSuccess()).toBe(true);
    if (confirmed.isSuccess()) {
      expect(confirmed.value.contact?.name).toBe('Ivan Petrov');
    }
  });
});
