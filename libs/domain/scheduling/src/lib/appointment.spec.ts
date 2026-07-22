import { ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
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
import { TimeSlot } from './time-slot';

const zone = 'Europe/Sofia';

function slot(startIso: string, endIso: string): TimeSlot {
  const r = TimeSlot.create({ startIso, endIso, zone });
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function oneSeat(): Seat[] {
  return [
    Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.account(UserId.generate(), 'self'),
      serviceId: ServiceId.generate(),
    }),
  ];
}

function reconstituteWithStatus(status: AppointmentStatus): Appointment {
  const result = Appointment.reconstitute({
    id: 'appointment-1',
    barberId: BarberId.generate().toString(),
    locationId: LocationId.generate().toString(),
    timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
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
      barberId: BarberId.generate().toString(),
      locationId: LocationId.generate().toString(),
      timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
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
      barberId: BarberId.generate().toString(),
      locationId: LocationId.generate().toString(),
      timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
      seats: oneSeat(),
      now: at('2026-07-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty seats array', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      barberId: BarberId.generate().toString(),
      locationId: LocationId.generate().toString(),
      timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
      seats: [],
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects more than one "self" seat', () => {
    const result = Appointment.create({
      id: 'appointment-1',
      barberId: BarberId.generate().toString(),
      locationId: LocationId.generate().toString(),
      timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
      seats: [...oneSeat(), ...oneSeat()],
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = Appointment.create({
      id: '',
      barberId: BarberId.generate().toString(),
      locationId: LocationId.generate().toString(),
      timeSlot: slot('2026-06-01T10:00:00', '2026-06-01T10:30:00'),
      seats: oneSeat(),
      now: at('2026-05-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
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
