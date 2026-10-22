import { TestBed } from '@angular/core/testing';
import { EMPTY, type Observable, Subject, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  GATEWAY_PORTS,
  LOCATION_LOAD_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  type AccountAppointmentReadPorts,
  type AppointmentReadPorts,
  Callables,
  type LocationLoadPorts,
} from '@core/ports';
import type { Appointment } from '@core/entities';
import {
  BookingLifecycle,
  BookingCall,
  CancellationReason,
  CancellationReasonSet,
  Seat,
} from '@core/components';
import {
  AppointmentId,
  BusyKey,
  CancellationRefusalCode,
  LocalDate,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
  Result,
  type TimeZone,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  type GatewayCall,
  type GatewayScript,
  appointmentFixture,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  minute,
  pinnedNowUtcMs,
  scriptedGatewayPorts,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { AppointmentsStore, AppointmentsViewState } from './appointments.store';

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
  reads: Partial<AccountAppointmentReadPorts>,
): AppointmentReadPorts {
  return {
    ...memoryAppointmentReadPorts([]),
    observeUpcoming: reads.observeUpcoming ?? (() => EMPTY),
    observeHistory: reads.observeHistory ?? (() => EMPTY),
  };
}

/** The deployment's default shop, on the fixture zone unless given. */
function defaultShop(
  timeZone: TimeZone = FIXTURE_TIME_ZONE,
): LocationLoadPorts {
  return memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture({ timeZone })] }),
  );
}

interface Configure {
  /** Per callable, its answer — `cancelAppointment` answers ok unless given. */
  readonly gateway?: GatewayScript;
  /** Every callable the store dialled, in order. */
  readonly calls?: GatewayCall[];
  /** The location reads the shop's zone comes from — the fixture shop by default. */
  readonly locations?: LocationLoadPorts;
}

function configure(
  reads: AppointmentReadPorts,
  extras: Configure = {},
): AppointmentsStore {
  TestBed.configureTestingModule({
    providers: [
      AppointmentsStore,
      { provide: APPOINTMENT_READ_PORTS, useValue: reads },
      {
        // Cancellation goes through the CALLABLE gateway, never a write
        // port — the web never writes an appointment.
        provide: GATEWAY_PORTS,
        useValue: scriptedGatewayPorts(
          {
            [Callables.CancelAppointment]: (input: BookingCall.Cancel) =>
              Result.ok({ appointmentId: input.appointmentId }),
            ...extras.gateway,
          },
          extras.calls,
        ),
      },
      // The pinned clock: 2026-09-28 09:00 at the fixture shop.
      { provide: CLOCK_PORTS, useValue: { nowUtcMs: pinnedNowUtcMs() } },
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: extras.locations ?? defaultShop(),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
    ],
  });
  return TestBed.inject(AppointmentsStore);
}

/** Lets the shop's zone read answer, then flushes the signals. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

describe('AppointmentsStore', () => {
  it('starts loading, then reflects the repository stream once a userId is set', async () => {
    const upcoming$ = new Subject<AppointmentsResult>();
    const store = configure(
      // Staff-side readers the bundle carries; this store only watches upcoming.
      appointmentReads({ observeUpcoming: () => upcoming$.asObservable() }),
    );
    await settle();

    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Loading,
    );

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Loading,
    );

    upcoming$.next(Result.ok([appointmentAt('appt_1', '2030-06-01', 600)]));
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Ready,
    );
    expect(store.appointments()).toHaveLength(1);
  });

  it('surfaces a repository failure as the error state', async () => {
    const store = configure(
      appointmentReads({
        observeUpcoming: () =>
          of(Result.err(RepositoryError.readFailed('appointments', 'boom'))),
      }),
    );
    await settle();

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Error,
    );
  });

  it('retry() opens both reads afresh, and loads until the new listener answers', async () => {
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
    await settle();

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    upcomingReads[0]?.next(
      Result.err(RepositoryError.readFailed('appointments', 'denied')),
    );
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Error,
    );

    store.retry();
    TestBed.tick();
    // A fresh pair of listeners — the failed one has stopped for good —
    // and the failure is not shown while the new one is on its way.
    expect(upcomingReads).toHaveLength(2);
    expect(historyReads).toBe(2);
    expect(upcomingReads[0]?.observed).toBe(false);
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Loading,
    );

    upcomingReads[1]?.next(
      Result.ok([appointmentAt('appt_1', '2030-06-01', 600)]),
    );
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Ready,
    );
    expect(store.appointments()).toHaveLength(1);
  });

  it('files a visit under history once it has begun or settled, never while it is still ahead', async () => {
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
    await settle();

    store.setUserId(UserId.of('user_1'));
    TestBed.tick();
    expect(store.history().map((appointment) => appointment.id)).toEqual([
      'called-off',
      'begun',
    ]);
  });

  it('reads "today" on the default shop’s zone, and loads until that zone has resolved', async () => {
    // 2026-09-28T06:00Z is still the 27th, 23:00, in Los Angeles.
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      {
        locations: defaultShop(
          unwrapOk(ZonedTimeSystem.checkZone('America/Los_Angeles')),
        ),
      },
    );
    store.setUserId(UserId.of('user_1'));
    TestBed.tick();

    // The read has answered, but nothing is filed against a day yet.
    expect(store.now()).toBeNull();
    expect(store.today()).toBeNull();
    expect(store.focusedMonth()).toBeNull();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Loading,
    );

    await settle();
    expect(store.today()).toBe('2026-09-27');
    expect(store.now()?.currentMinute).toBe(23 * 60);
    expect(store.nowUtcMs).toBe(FIXTURE_NOW_UTC_MS);
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Ready,
    );
  });

  it('shows its failed state when the shop’s zone cannot be read, and reads the zone again on retry (4A-2 (e))', async () => {
    let up = false;
    const shop = defaultShop();
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      {
        locations: {
          loadLocation: async (id) =>
            up
              ? shop.loadLocation(id)
              : Result.err(
                  RepositoryError.readFailed('locations/loc-center', 'down'),
                ),
        },
      },
    );
    store.setUserId(UserId.of('user_1'));
    await settle();
    expect(store.today()).toBeNull();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Error,
    );

    up = true;
    store.retry();
    TestBed.tick();
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Loading,
    );
    await settle();
    expect(store.today()).toBe('2026-09-28');
    expect(store.upcoming().appointmentsViewState).toBe(
      AppointmentsViewState.Ready,
    );
  });

  it('nextMonth()/previousMonth() move the focused month forward/back from today', async () => {
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
    );
    await settle();

    // The pinned today is 2026-09-28: its month, as its first day.
    expect(store.focusedMonth()).toBe('2026-09-01');
    store.nextMonth();
    expect(store.focusedMonth()).toBe('2026-10-01');
    store.previousMonth();
    store.previousMonth();
    expect(store.focusedMonth()).toBe('2026-08-01');
  });

  it('cancel() files the client’s words as OTHER through the gateway and reports success', async () => {
    const calls: GatewayCall[] = [];
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      { calls },
    );

    const outcome = await store.cancel(
      AppointmentId.of('appt_1'),
      'client requested',
    );

    expect(outcome).toBe(true);
    expect(calls).toEqual([
      {
        callable: Callables.CancelAppointment,
        input: { appointmentId: 'appt_1', reason: CancellationReason.Other },
      },
    ]);
    expect(store.cancelError()).toBeNull();
    expect(store.cancellingId()).toBeNull();
  });

  it('cancel() files nothing typed — or only blanks — as UNSPECIFIED', async () => {
    const calls: GatewayCall[] = [];
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      { calls },
    );

    await store.cancel(AppointmentId.of('appt_1'), '');
    await store.cancel(AppointmentId.of('appt_2'), '   ');

    expect(calls.map((call) => call.input)).toEqual([
      { appointmentId: 'appt_1', reason: CancellationReason.Unspecified },
      { appointmentId: 'appt_2', reason: CancellationReason.Unspecified },
    ]);
  });

  it('cancel() keeps the call’s refusal for the sheet to word', async () => {
    const refusal = PipelineError.fromWire('failed-precondition', {
      errorCode: CancellationRefusalCode.WindowClosed,
      windowHours: 24,
    });
    const store = configure(
      appointmentReads({ observeUpcoming: () => of(Result.ok([])) }),
      {
        gateway: {
          [Callables.CancelAppointment]: () => Result.err(refusal),
        },
      },
    );

    const outcome = await store.cancel(AppointmentId.of('appt_1'), 'reason');

    expect(outcome).toBe(false);
    expect(store.cancelError()).toEqual(refusal);
    expect(store.cancelError()?.errorCode).toBe(
      PipelineErrorCode.InvalidRequest,
    );
    expect(store.cancellingId()).toBeNull();

    store.clearCancelError();
    expect(store.cancelError()).toBeNull();
  });
});
