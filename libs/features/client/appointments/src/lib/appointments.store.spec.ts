import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  AppointmentId,
  AppointmentRepository,
  Result,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
  fail,
  ok,
} from '@creativo/application/booking';
import { ServiceId } from '@creativo/application/catalog';
import { AppointmentsStore } from './appointments.store';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function appointmentAt(id: string, startIso: string): Appointment {
  const start = unwrap(ZonedDateTime.fromISO(startIso, 'Europe/Sofia'));
  const timeSlot = unwrap(
    TimeSlot.create({
      startIso,
      endIso: start.plusMinutes(30).toISO(),
      zone: 'Europe/Sofia',
    }),
  );
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat_1')),
    subject: SeatSubject.account(unwrap(UserId.create('user_1')), 'self'),
    serviceId: unwrap(ServiceId.create('service_1')),
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      barberId: 'barber_1',
      locationId: 'location_1',
      timeSlot,
      seats: [seat],
      status: { kind: 'confirmed' },
    }),
  );
}

function configure(repository: AppointmentRepository): AppointmentsStore {
  TestBed.configureTestingModule({
    providers: [
      AppointmentsStore,
      { provide: APPOINTMENT_REPOSITORY, useValue: repository },
      {
        provide: CLOCK,
        useValue: { now: (zone: string) => ZonedDateTime.now(zone) },
      },
    ],
  });
  return TestBed.inject(AppointmentsStore);
}

describe('AppointmentsStore', () => {
  it('starts loading, then reflects the repository stream once a userId is set', () => {
    const upcoming$ = new Subject<
      Result<readonly Appointment[], RepositoryError>
    >();
    const store = configure({
      findById: async () => ok(null),
      save: async () => ok(undefined),
      observeUpcomingFor: () => upcoming$.asObservable(),
    });

    expect(store.upcoming().kind).toBe('loading');

    store.setUserId(unwrap(UserId.create('user_1')));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('loading');

    upcoming$.next(ok([appointmentAt('appt_1', '2030-06-01T10:00:00')]));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('ready');
    expect(store.appointments()).toHaveLength(1);
  });

  it('surfaces a repository failure as the error state', () => {
    const store = configure({
      findById: async () => ok(null),
      save: async () => ok(undefined),
      observeUpcomingFor: () => of(fail(new RepositoryError('boom'))),
    });

    store.setUserId(unwrap(UserId.create('user_1')));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('error');
  });

  it('nextMonth()/previousMonth() move the focused month forward/back from today', () => {
    const store = configure({
      findById: async () => ok(null),
      save: async () => ok(undefined),
      observeUpcomingFor: () => of(ok([])),
    });

    const startMonth = store.focusedMonth().month;
    store.nextMonth();
    const nextMonth = store.focusedMonth().month;
    store.previousMonth();
    store.previousMonth();
    const prevMonth = store.focusedMonth().month;

    expect(nextMonth).not.toBe(startMonth);
    expect(prevMonth).not.toBe(startMonth);
  });

  it('cancel() runs the domain transition through the repository and reports success', async () => {
    const savedAppointments: Appointment[] = [];
    const store = configure({
      findById: async () => ok(appointmentAt('appt_1', '2030-06-01T10:00:00')),
      save: async (a: Appointment) => {
        savedAppointments.push(a);
        return ok(undefined);
      },
      observeUpcomingFor: () => of(ok([])),
    });

    const outcome = await store.cancel(
      unwrap(AppointmentId.create('appt_1')),
      'client requested',
    );

    expect(outcome).toBe(true);
    expect(savedAppointments).toHaveLength(1);
    expect(savedAppointments[0]?.status.kind).toBe('cancelled');
    expect(store.cancelError()).toBeNull();
  });

  it('cancel() surfaces a translated-ready DomainError on failure', async () => {
    const store = configure({
      findById: async () => ok(null),
      save: async () => ok(undefined),
      observeUpcomingFor: () => of(ok([])),
    });

    const outcome = await store.cancel(
      unwrap(AppointmentId.create('missing')),
      'reason',
    );

    expect(outcome).toBe(false);
    expect(store.cancelError()?.code).toBe(
      'booking.cancel_appointment.not_found',
    );
  });
});
