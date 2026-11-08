import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  CATALOG_PORTS,
  CLIENT_ISSUE_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  DEFAULT_LOCATION_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  MEDIA_RESOLVE_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { BarberId, LocationId, Result } from '@core/primitives';
import { DayHours } from '@core/components';
import type {
  Barber,
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
  ShopLocation,
} from '@core/entities';
import type {
  AppointmentNotePorts,
  AppointmentReadPorts,
  ClientIssuePorts,
  ClockPorts,
  CouponVoucherPorts,
  IdPorts,
  MediaResolvePorts,
  ObserveBarberDay,
} from '@core/ports';
import {
  type GatewayCall,
  type GatewayScript,
  at,
  barberFixture,
  locationFixture,
  memoryAppointmentPhotoPorts,
  memoryAuthSessionPorts,
  memoryCatalogReadPorts,
  memoryClockPorts,
  memoryCouponVoucherPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryScheduleExceptionPorts,
  memorySchedulingReadPorts,
  recordingClientIssuePorts,
  scriptedGatewayPorts,
  until,
  utcMs,
} from '@core/testing';
import { StaffDayStore } from './staff-day.store';

/*
 * THE STAFF DAY STORE'S TEST HARNESS — shared by its own spec and by the
 * analytics agreement spec, which runs the store's lanes over the analytics
 * fixture month. `.spec-support.ts`: compiled with the specs, never with the
 * library.
 */

export const CENTER = LocationId.of('loc-center');
export const IVAN = BarberId.of('ivan');

/** The fixture's shop, open around the clock so no roster is clamped here. */
export const CENTER_SHOP = locationFixture({
  id: CENTER,
  openingHours: Array.from({ length: 7 }, () =>
    DayHours.open(at(0), until(24)),
  ),
});

export interface StaffDayStoreHarness {
  readonly store: StaffDayStore;
  readonly router: Router;
}

/** Lets the store's streams and effects run to rest — four ticks with a macrotask between. */
export async function settleStaffDayStore(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  TestBed.tick();
}

/**
 * The store under `TestBed`, every port in memory: one shop open around the
 * clock and Ivan's chair by default, the clock pinned at `nowIso`. A
 * spec states only what its case reads.
 */
export async function buildStaffDayStore(
  options: {
    readonly nowIso?: string;
    readonly shops?: readonly ShopLocation[];
    readonly defaultShops?: readonly ShopLocation[];
    readonly schedules?: readonly BarberSchedule[];
    /** The catalogue's barbers — Ivan at the centre by default. */
    readonly barbers?: readonly Barber[];
    /** The days' exceptions as the scheduling stream answers them — none by default. */
    readonly exceptions?: readonly ScheduleException[];
    /** The busy projection's days — none by default. */
    readonly busyDays?: readonly BarberBusyDay[];
    readonly storedView?: string;
    readonly url?: string;
    readonly notes?: AppointmentNotePorts;
    /** The chairs' days as the read port answers them — every chair empty and clean by default. */
    readonly barberDay?: ObserveBarberDay;
    readonly couponsVouchers?: CouponVoucherPorts;
    /** The id source each act's `operationId` is minted from — one fixed name by default. */
    readonly ids?: IdPorts;
    /** Every callable the store dialled, in order (each answers `PIPELINE_UNKNOWN`). */
    readonly calls?: GatewayCall[];
    /** The callables that succeed, by name (the rest answer `PIPELINE_UNKNOWN`). */
    readonly script?: GatewayScript;
    /** The instant the store reads — pinned at `nowIso` by default. */
    readonly clock?: ClockPorts;
    /** The search window's read port — an empty, uncapped window by default. */
    readonly searchWindow?: AppointmentReadPorts['searchAppointmentWindow'];
    /** The client issue sink — a recording one by default (`issues.reported`). */
    readonly issues?: ClientIssuePorts;
  } = {},
): Promise<StaffDayStoreHarness> {
  localStorage.clear();
  if (options.storedView !== undefined) {
    localStorage.setItem('staff.schedule.view', options.storedView);
  }
  const shops = options.shops ?? [CENTER_SHOP];
  TestBed.configureTestingModule({
    providers: [
      StaffDayStore,
      provideRouter([]),
      {
        provide: CLOCK_PORTS,
        useValue:
          options.clock ??
          memoryClockPorts(
            utcMs(options.nowIso ?? '2026-08-05T09:00:00.000+03:00'),
          ),
      },
      {
        provide: ID_PORTS,
        useValue: options.ids ?? { nextId: () => 'operation-000000000001' },
      },
      {
        provide: CLIENT_ISSUE_PORTS,
        useValue: options.issues ?? recordingClientIssuePorts().ports,
      },
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(
          memoryProgramsWorld({ locations: options.defaultShops ?? shops }),
        ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(CENTER),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: {
          observeAppointment: () => of(Result.ok(null)),
          observeBarberDay:
            options.barberDay ??
            (() => of(Result.ok({ appointments: [], unreadableCount: 0 }))),
          observeUpcoming: () => of(Result.ok([])),
          observeHistory: () => of(Result.ok([])),
          pageClientHistory: async () =>
            Result.ok({ appointments: [], nextBeforeUtcMs: null }),
          searchAppointmentWindow:
            options.searchWindow ??
            (async () => Result.ok({ appointments: [], capped: false })),
        } satisfies AppointmentReadPorts,
      },
      {
        provide: GATEWAY_PORTS,
        useValue: scriptedGatewayPorts(options.script ?? {}, options.calls),
      },
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({
          barbers: options.barbers ?? [
            barberFixture({ id: IVAN, locationIds: [CENTER] }),
          ],
          locations: shops,
        }),
      },
      {
        provide: SCHEDULING_READ_PORTS,
        useValue: memorySchedulingReadPorts({
          locations: shops,
          schedules: options.schedules ?? [],
          exceptions: options.exceptions ?? [],
          busyDays: options.busyDays ?? [],
        }),
      },
      {
        provide: SCHEDULE_EXCEPTION_PORTS,
        useValue: memoryScheduleExceptionPorts([]),
      },
      { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
      {
        provide: APPOINTMENT_NOTE_PORTS,
        useValue:
          options.notes ??
          ({
            observeAppointmentNote: () => of(Result.ok(null)),
            saveAppointmentNote: async () => Result.ok(undefined),
            updateAppointmentNote: async (_appointmentId, decide) =>
              Result.ok(decide(null)),
          } satisfies AppointmentNotePorts),
      },
      {
        provide: APPOINTMENT_PHOTO_PORTS,
        useValue: memoryAppointmentPhotoPorts([]),
      },
      {
        provide: COUPON_VOUCHER_PORTS,
        useValue: options.couponsVouchers ?? memoryCouponVoucherPorts(),
      },
      {
        provide: MEDIA_RESOLVE_PORTS,
        useValue: {
          resolveMedia: async () => Result.ok([]),
        } satisfies MediaResolvePorts,
      },
    ],
  });
  const router = TestBed.inject(Router);
  if (options.url !== undefined) await router.navigateByUrl(options.url);
  const store = TestBed.inject(StaffDayStore);
  await settleStaffDayStore();
  return { store, router };
}
