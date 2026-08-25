import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject, of } from 'rxjs';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  AppointmentId,
  AppointmentRepository,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  BookingPolicy,
  BookingGateway,
  BookingGatewayError,
  Result,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
  fail,
  ok,
} from '@creativo/application/booking';
import { NOTIFICATION_READER } from '@creativo/application/notifications';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
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
    variantId: null,
    barberId: unwrap(BarberId.create('barber_1')),
    terms: unwrap(ServiceTerms.fromMinorUnits(1500, 'EUR', 30)),
    startsAt: timeSlot.start,
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      locationId: 'location_1',
      seats: [seat],
      status: { kind: 'confirmed' },
    }),
  );
}

function configure(
  repository: AppointmentRepository,
  gateway: Partial<BookingGateway> = {},
): AppointmentsStore {
  TestBed.configureTestingModule({
    providers: [
      AppointmentsStore,
      {
        // The shell menu's notifications row reads the inbox.
        provide: NOTIFICATION_READER,
        useValue: {
          list: () => of(ok([])),
          markRead: async () => ok(undefined),
          markAllRead: async () => ok(undefined),
        },
      },
      { provide: APPOINTMENT_REPOSITORY, useValue: repository },
      {
        // Cancellation goes through the CALLABLE gateway, never the
        // repository — the repository's save() refuses on the client.
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: async () => {
            throw new Error('not used in this spec');
          },
          cancel: async () => ok(undefined),
          ...gateway,
        },
      },
      {
        provide: BOOKING_POLICY_READER,
        useValue: { observe: () => of(BookingPolicy.default()) },
      },
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
      // Staff-side readers the port grew; this store only watches upcoming.
      observeHistoryFor: () => EMPTY,
      observeBarberDay: () => EMPTY,
      searchWindow: async () => ok([]),
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
      observeHistoryFor: () => EMPTY,
      observeBarberDay: () => EMPTY,
      searchWindow: async () => ok([]),
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
      observeHistoryFor: () => EMPTY,
      observeBarberDay: () => EMPTY,
      searchWindow: async () => ok([]),
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

  it('cancel() sends the id and reason through the gateway and reports success', async () => {
    const cancelled: { appointmentId: string; reason: string }[] = [];
    const store = configure(
      {
        findById: async () => ok(null),
        save: async () => ok(undefined),
        observeUpcomingFor: () => of(ok([])),
        observeHistoryFor: () => EMPTY,
        observeBarberDay: () => EMPTY,
        searchWindow: async () => ok([]),
      },
      {
        cancel: async (request) => {
          cancelled.push(request);
          return ok(undefined);
        },
      },
    );

    const outcome = await store.cancel(
      unwrap(AppointmentId.create('appt_1')),
      'client requested',
    );

    expect(outcome).toBe(true);
    expect(cancelled).toEqual([
      { appointmentId: 'appt_1', reason: 'client requested' },
    ]);
    expect(store.cancelError()).toBeNull();
  });

  it('cancel() surfaces a translated-ready DomainError on failure', async () => {
    const store = configure(
      {
        findById: async () => ok(null),
        save: async () => ok(undefined),
        observeUpcomingFor: () => of(ok([])),
        observeHistoryFor: () => EMPTY,
        observeBarberDay: () => EMPTY,
        searchWindow: async () => ok([]),
      },
      {
        cancel: async () =>
          fail(new BookingGatewayError('invalid_request', 'no such booking')),
      },
    );

    const outcome = await store.cancel(
      unwrap(AppointmentId.create('missing')),
      'reason',
    );

    expect(outcome).toBe(false);
    expect(store.cancelError()?.code).toBe('booking.gateway.failed');
  });
});
