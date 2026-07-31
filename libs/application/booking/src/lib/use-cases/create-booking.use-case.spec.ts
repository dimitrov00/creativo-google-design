import { describe, expect, it } from 'vitest';
import {
  InvalidTimeZoneError,
  Money,
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
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import { ClockPort, RepositoryError } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import { CreateBookingUseCase } from './create-booking.use-case';
import { CreateBookingValidationFailure } from './create-booking.errors';

function seatTerms(durationMinutes = 30, priceMinorUnits = 1500): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(priceMinorUnits, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, durationMinutes);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

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
      locationId,
      schedulingZone: 'Europe/Sofia',
      seats: [
        {
          subject: SeatSubject.anonymous(label),
          serviceId,
          variantId: null,
          barberId,
          terms: seatTerms(),
          slot: timeSlot(),
        },
      ],
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
      locationId: requiredValue(LocationId.create('location_1')),
      schedulingZone: 'Europe/Sofia',
      seats: [],
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CreateBookingValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
