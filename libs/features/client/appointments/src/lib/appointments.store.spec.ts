import { TestBed } from '@angular/core/testing';
import { EMPTY, type Observable, Subject, of } from 'rxjs';
import { CLOCK } from '@creativo/application/shared';
import { ZonedDateTime } from '@creativo/application/accounts';
import {
  BOOKING_GATEWAY,
  BookingGateway,
  BookingGatewayError,
  fail,
  ok,
} from '@creativo/application/booking';
import {
  APPOINTMENT_READ_PORTS,
  INBOX_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { AppointmentReadPorts } from '@core/ports';
import type { Appointment } from '@core/entities';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  Seat,
} from '@core/components';
import {
  AppointmentId,
  BusyKey,
  LocalDate,
  RepositoryError,
  Result,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  memoryAppointmentReadPorts,
  memoryInboxPorts,
  minute,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { AppointmentsStore } from './appointments.store';

type AppointmentsResult = Result<readonly Appointment[], RepositoryError>;

/** A confirmed one-seat visit at `HH:MM` (minutes from midnight) on the shop day `localDate`. */
function appointmentAt(
  id: string,
  localDate: string,
  startMinutes: number,
  lifecycle?: BookingLifecycle,
): Appointment {
  const day = unwrapOk(LocalDate.parse(localDate));
  const seat = seatFixture({ startMinutes: minute(startMinutes) });
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, seat.startMinutes, FIXTURE_TIME_ZONE),
    ),
    seats: [seat],
    busyKeys: [BusyKey.of(seat.barberId, day)],
    ...(lifecycle ? { lifecycle } : {}),
  });
}

/**
 * The appointment reads this store opens: the double, with the two members
 * a spec scripts (a held, failing or counted listener) wrapped; the rest
 * answer an empty book.
 */
function appointmentReads(
  reads: Partial<
    Pick<AppointmentReadPorts, 'observeUpcoming' | 'observeHistory'>
  >,
): AppointmentReadPorts {
  return {
    ...memoryAppointmentReadPorts([]),
    observeUpcoming: reads.observeUpcoming ?? (() => EMPTY),
    observeHistory: reads.observeHistory ?? (() => EMPTY),
  };
}

function configure(
  reads: AppointmentReadPorts,
  gateway: Partial<BookingGateway> = {},
): AppointmentsStore {
  TestBed.configureTestingModule({
    providers: [
      AppointmentsStore,
      // The shell menu's notifications row reads the inbox.
      { provide: INBOX_PORTS, useValue: memoryInboxPorts(new Map()) },
      { provide: APPOINTMENT_READ_PORTS, useValue: reads },
      {
        // Cancellation goes through the CALLABLE gateway, never a write
        // port — the web never writes an appointment.
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
        provide: CLOCK,
        useValue: {
          now: (zone: string) =>
            ZonedDateTime.fromMillis(FIXTURE_NOW_UTC_MS, zone),
        },
      },
    ],
  });
  return TestBed.inject(AppointmentsStore);
}

describe('AppointmentsStore', () => {
  it('starts loading, then reflects the repository stream once a userId is set', () => {
    const upcoming$ = new Subject<AppointmentsResult>();
    const store = configure(
      // Staff-side readers the bundle carries; this store only watches upcoming.
      appointmentReads({ observeUpcoming: () => upcoming$.asObservable() }),
    );

    expect(store.upcoming().kind).toBe('loading');

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('loading');

    upcoming$.next(Result.ok([appointmentAt('appt_1', '2030-06-01', 600)]));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('ready');
    expect(store.appointments()).toHaveLength(1);
  });

  it('surfaces a repository failure as the error state', () => {
    const store = configure(
      appointmentReads({
        observeUpcoming: () =>
          of(Result.err(RepositoryError.readFailed('appointments', 'boom'))),
      }),
    );

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.upcoming().kind).toBe('error');
  });

  it('retry() opens both reads afresh, and loads until the new listener answers', () => {
    const upcomingReads: Subject<AppointmentsResult>[] = [];
    let historyReads = 0;
    const store = configure(
      appointmentReads({
        observeUpcoming: () => {
          const read = new Subject<AppointmentsResult>();
          upcomingReads.push(read);
          return read.asObservable();
        },
        observeHistory: (): Observable<AppointmentsResult> => {
          historyReads += 1;
          return of(Result.ok([]));
        },
      }),
    );

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    upcomingReads[0]?.next(
      Result.err(RepositoryError.readFailed('appointments', 'denied')),
    );
    TestBed.tick();
    expect(store.upcoming().kind).toBe('error');

    store.retry();
    TestBed.tick();
    // A fresh pair of listeners — the failed one has stopped for good —
    // and the failure is not shown while the new one is on its way.
    expect(upcomingReads).toHaveLength(2);
    expect(historyReads).toBe(2);
    expect(upcomingReads[0]?.observed).toBe(false);
    expect(store.upcoming().kind).toBe('loading');

    upcomingReads[1]?.next(
      Result.ok([appointmentAt('appt_1', '2030-06-01', 600)]),
    );
    TestBed.tick();
    expect(store.upcoming().kind).toBe('ready');
    expect(store.appointments()).toHaveLength(1);
  });

  it('files a visit under history once it has begun or settled, never while it is still ahead', () => {
    const store = configure(
      appointmentReads({
        observeHistory: () =>
          of(
            Result.ok([
              // Ahead and open: the upcoming list's, not the history's.
              appointmentAt('ahead', '2030-06-01', 600),
              // Ahead, but already cancelled: settled is history.
              appointmentAt(
                'called-off',
                '2030-06-02',
                600,
                BookingLifecycle.cancel(
                  FIXTURE_NOW_UTC_MS,
                  CancellationReasonSet.of([CancellationReason.Unspecified]),
                ),
              ),
              // Begun (the pinned now is 2026-09-28 09:00 at the shop).
              appointmentAt('begun', '2026-09-28', 540),
            ]),
          ),
      }),
    );

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.history().map((appointment) => appointment.id)).toEqual([
      'called-off',
      'begun',
    ]);
  });

  it('nextMonth()/previousMonth() move the focused month forward/back from today', () => {
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
    );

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
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      {
        cancel: async (request) => {
          cancelled.push(request);
          return ok(undefined);
        },
      },
    );

    const outcome = await store.cancel(
      AppointmentId.of('appt_1'),
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
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      {
        cancel: async () =>
          fail(new BookingGatewayError('invalid_request', 'no such booking')),
      },
    );

    const outcome = await store.cancel(AppointmentId.of('missing'), 'reason');

    expect(outcome).toBe(false);
    expect(store.cancelError()?.code).toBe('booking.gateway.failed');
  });
});
