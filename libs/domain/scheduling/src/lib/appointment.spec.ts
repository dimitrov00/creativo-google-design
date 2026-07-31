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
import { SeatId } from './ids';
import { Seat, SeatSubject } from './seat';

const zone = 'Europe/Sofia';

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
    no_show: [],
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
    completed: (a) => a.complete(),
    cancelled: (a) => a.cancel('customer request'),
    no_show: (a) => a.markNoShow(),
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
    const result = appointment.cancel('   ');
    expect(result.isFailure()).toBe(true);
  });

  it('carries the reason structurally on the cancelled status', () => {
    const appointment = reconstituteWithStatus(PENDING);
    const result = appointment.cancel('no longer needed');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.status.kind === 'cancelled') {
      expect(result.value.status.reason).toBe('no longer needed');
    }
  });
});
