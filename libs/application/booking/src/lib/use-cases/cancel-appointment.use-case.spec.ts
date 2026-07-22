import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  AppointmentId,
  Seat,
  SeatId,
  SeatLabel,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import { CancelAppointmentUseCase } from './cancel-appointment.use-case';
import { AppointmentNotFoundError } from './cancel-appointment.errors';
import { AppointmentEmptyCancellationReasonError } from '@creativo/domain/scheduling';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function pendingAppointment(): Appointment {
  const now = requiredValue(
    ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
  );
  const timeSlot = requiredValue(
    TimeSlot.create({
      startIso: '2026-06-01T10:00:00.000+03:00',
      endIso: '2026-06-01T10:30:00.000+03:00',
      zone: 'Europe/Sofia',
    }),
  );
  const seat = Seat.of({
    id: requiredValue(SeatId.create('seat_1')),
    subject: SeatSubject.anonymous(
      requiredValue(SeatLabel.create('Walk-in 10:00')),
    ),
    serviceId: requiredValue(ServiceId.create('service_1')),
  });
  return requiredValue(
    Appointment.create({
      id: 'appt_1',
      barberId: requiredValue(BarberId.create('barber_1')).value,
      locationId: requiredValue(LocationId.create('location_1')).value,
      timeSlot,
      seats: [seat],
      now,
    }),
  );
}

function fakeRepository(seed?: Appointment): AppointmentRepository & {
  saved: Appointment[];
} {
  const saved: Appointment[] = [];
  const store = new Map<string, Appointment>();
  if (seed) store.set(seed.id.value, seed);
  return {
    saved,
    async save(appointment): Promise<Result<void, RepositoryError>> {
      saved.push(appointment);
      store.set(appointment.id.value, appointment);
      return ok(undefined);
    },
    async findById(id): Promise<Result<Appointment | null, RepositoryError>> {
      return ok(store.get(id.value) ?? null);
    },
    observeUpcomingFor() {
      throw new Error('not used in this spec');
    },
  };
}

describe('CancelAppointmentUseCase', () => {
  it('cancels a pending appointment with a reason', async () => {
    const appointment = pendingAppointment();
    const repo = fakeRepository(appointment);
    const useCase = new CancelAppointmentUseCase(repo);

    const result = await useCase.execute({
      appointmentId: appointment.id,
      reason: 'client requested cancellation',
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status.kind).toBe('cancelled');
    }
    expect(repo.saved).toHaveLength(1);
  });

  it('rejects an empty cancellation reason', async () => {
    const appointment = pendingAppointment();
    const repo = fakeRepository(appointment);
    const useCase = new CancelAppointmentUseCase(repo);

    const result = await useCase.execute({
      appointmentId: appointment.id,
      reason: '   ',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(
        AppointmentEmptyCancellationReasonError,
      );
    }
  });

  it('reports not-found for an unknown appointment id', async () => {
    const repo = fakeRepository();
    const useCase = new CancelAppointmentUseCase(repo);

    const result = await useCase.execute({
      appointmentId: requiredValue(AppointmentId.create('nope')),
      reason: 'client requested cancellation',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(AppointmentNotFoundError);
    }
  });
});
