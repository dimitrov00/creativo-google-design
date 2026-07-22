import { describe, expect, it } from 'vitest';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  Appointment,
  SeatLabel,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { ClockPort, RepositoryError } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import { CreateBookingUseCase } from './create-booking.use-case';
import { CreateBookingValidationFailure } from './create-booking.errors';

function fakeRepository(): AppointmentRepository & {
  saved: Appointment[];
} {
  const saved: Appointment[] = [];
  return {
    saved,
    async save(appointment): Promise<Result<void, RepositoryError>> {
      saved.push(appointment);
      return ok(undefined);
    },
    async findById(): Promise<Result<Appointment | null, RepositoryError>> {
      return ok(null);
    },
    observeUpcomingFor() {
      throw new Error('not used in this spec');
    },
  };
}

function fakeClock(iso: string): ClockPort {
  return {
    now: (zone: string): Result<ZonedDateTime, InvalidTimeZoneError> => {
      const result = ZonedDateTime.fromISO(iso, zone);
      return result.isFailure()
        ? fail(new InvalidTimeZoneError(zone))
        : ok(result.value);
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function timeSlot(): TimeSlot {
  return requiredValue(
    TimeSlot.create({
      startIso: '2026-06-01T10:00:00.000+03:00',
      endIso: '2026-06-01T10:30:00.000+03:00',
      zone: 'Europe/Sofia',
    }),
  );
}

describe('CreateBookingUseCase', () => {
  it('creates and saves a pending appointment for a self seat', async () => {
    const repo = fakeRepository();
    const useCase = new CreateBookingUseCase(
      repo,
      fakeClock('2026-01-01T00:00:00.000Z'),
      fakeIdGenerator('id'),
    );

    const barberId = requiredValue(BarberId.create('barber_1'));
    const locationId = requiredValue(LocationId.create('location_1'));
    const serviceId = requiredValue(ServiceId.create('service_1'));
    const label = requiredValue(SeatLabel.create('Walk-in 10:00'));

    const result = await useCase.execute({
      barberId,
      locationId,
      timeSlot: timeSlot(),
      seats: [{ subject: SeatSubject.anonymous(label), serviceId }],
    });

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
    if (result.isSuccess()) {
      expect(result.value.status.kind).toBe('pending');
      expect(result.value.seats).toHaveLength(1);
    }
  });

  it('rejects a booking with no seats', async () => {
    const repo = fakeRepository();
    const useCase = new CreateBookingUseCase(
      repo,
      fakeClock('2026-01-01T00:00:00.000Z'),
      fakeIdGenerator('id'),
    );

    const result = await useCase.execute({
      barberId: requiredValue(BarberId.create('barber_1')),
      locationId: requiredValue(LocationId.create('location_1')),
      timeSlot: timeSlot(),
      seats: [],
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CreateBookingValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
