import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  CATALOG_PORTS,
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
import {
  AppointmentId,
  BarberId,
  LocalDate,
  LocationId,
  Result,
  Weekday,
} from '@core/primitives';
import { CatalogErrorCode, RepositoryError } from '@core/errors';
import { DayHours, ShiftSegment } from '@core/components';
import type {
  AppointmentNote,
  BarberSchedule,
  ShopLocation,
} from '@core/entities';
import type {
  AppointmentNotePorts,
  AppointmentReadPorts,
  MediaResolvePorts,
} from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  at,
  barberFixture,
  barberScheduleFixture,
  localDate,
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
  scriptedGatewayPorts,
  unwrapOk,
  until,
  utcMs,
} from '@core/testing';
import { StaffDayStore, StaffView, parseView } from './staff-day.store';

/*
 * THE STAFF DAY STORE, at its own edges (pass D) — the route's `?day=`,
 * `?barber=` and `?view=` read once into their brands, the zone of a shop
 * in scope and "now" per shop, the block writes' failure as a struct, and
 * the lanes carrying the roster's own wall-clock minutes. The page drives
 * all of it through the dashboard; these are the store's answers alone.
 * Clocks are pinned (`memoryClockPorts`), never the wall clock.
 */

const CENTER = LocationId.of('loc-center');
const LONDON = LocationId.of('loc-london');
const IVAN = BarberId.of('ivan');
const LONDON_ZONE = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));

/** The fixture's shop, open around the clock so no roster is clamped here. */
const CENTER_SHOP = locationFixture({
  id: CENTER,
  openingHours: Array.from({ length: 7 }, () =>
    DayHours.open(at(0), until(24)),
  ),
});

interface Harness {
  readonly store: StaffDayStore;
  readonly router: Router;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  TestBed.tick();
}

async function build(
  options: {
    readonly nowIso?: string;
    readonly shops?: readonly ShopLocation[];
    readonly defaultShops?: readonly ShopLocation[];
    readonly schedules?: readonly BarberSchedule[];
    readonly storedView?: string;
    readonly url?: string;
    readonly notes?: AppointmentNotePorts;
  } = {},
): Promise<Harness> {
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
        useValue: memoryClockPorts(
          utcMs(options.nowIso ?? '2026-08-05T09:00:00.000+03:00'),
        ),
      },
      {
        provide: ID_PORTS,
        useValue: { nextId: () => 'operation-000000000001' },
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
          observeBarberDay: () => of(Result.ok([])),
          observeUpcoming: () => of(Result.ok([])),
          observeHistory: () => of(Result.ok([])),
          pageClientHistory: async () =>
            Result.ok({ appointments: [], nextBeforeUtcMs: null }),
          searchAppointmentWindow: async () => Result.ok([]),
        } satisfies AppointmentReadPorts,
      },
      { provide: GATEWAY_PORTS, useValue: scriptedGatewayPorts() },
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({
          barbers: [barberFixture({ id: IVAN, locationIds: [CENTER] })],
          locations: shops,
        }),
      },
      {
        provide: SCHEDULING_READ_PORTS,
        useValue: memorySchedulingReadPorts({
          locations: shops,
          schedules: options.schedules ?? [],
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
      { provide: COUPON_VOUCHER_PORTS, useValue: memoryCouponVoucherPorts() },
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
  await settle();
  return { store, router };
}

afterEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
});

describe('StaffDayStore — ?day= read once at its edge', () => {
  it('applies a calendar day as chosen, and states it', async () => {
    const { store, router } = await build();
    expect(store.todayKey()).toBe('2026-08-05');
    store.applyRouteDay('2026-10-25');
    expect(store.dayKey()).toBe('2026-10-25');
    expect(store.showingStaleToday()).toBe(false);
    expect(store.isToday()).toBe(false);
    expect(store.published().day).toBe('2026-10-25');
    await settle();
    expect(router.url).toContain('day=2026-10-25');
  });

  // DEP-13: the old shape check let a well-formed impossible day through —
  // chosen, published, an empty canvas. `LocalDate.parse` refuses it: the
  // page lands on today, unchosen, and the address bar stops naming it.
  it.each(['2026-02-30', '2026-13-01'])(
    'falls back to today, unchosen, on %s — and corrects the address bar',
    async (raw) => {
      const { store, router } = await build({ url: `/?day=${raw}` });
      store.applyRouteDay(raw);
      expect(store.dayKey()).toBe('2026-08-05');
      expect(store.isToday()).toBe(true);
      expect(store.showingStaleToday()).toBe(false);
      expect(store.published().day).toBeNull();
      await settle();
      expect(router.url).not.toContain('day=');
    },
  );

  it('reads an absent or empty ?day= as today, writing nothing', async () => {
    const { store, router } = await build({ url: '/?day=' });
    store.applyRouteDay('');
    store.applyRouteDay(null);
    expect(store.dayKey()).toBe('2026-08-05');
    expect(store.published().day).toBeNull();
    await settle();
    // Silence stays silence: the empty parameter is not rewritten.
    expect(router.url).toBe('/?day=');
  });

  it('keeps a sheet’s probe only for a calendar day', async () => {
    const { store } = await build();
    // A probe joins the subscription, never the anchor.
    store.probeDay('2026-02-30');
    store.probeDay('2026-08-07');
    expect(store.dayKey()).toBe('2026-08-05');
    expect(store.cellFor(localDate('2026-08-05'))).not.toBeNull();
  });
});

describe('StaffDayStore — ?barber= read once at its edge', () => {
  it('applies a chair id as the scope, and states it', async () => {
    const { store, router } = await build();
    store.applyRouteBarber('ivan');
    expect(store.scope()).toBe('ivan');
    await settle();
    expect(router.url).toContain('barber=ivan');
  });

  // DEP-14: a value no chair id can be — one with a `/`, or blank — used to
  // stand as a scope of nobody until the catalogue's roster cleared it. It
  // is everyone at once now; the final address bar is the same (no chair).
  it.each(['a/b', ' '])(
    'reads %j as everyone at once, and the bar ends naming no chair',
    async (raw) => {
      const { store, router } = await build({
        url: `/?barber=${encodeURIComponent(raw)}`,
      });
      store.applyRouteBarber(raw);
      expect(store.scope()).toBeNull();
      await settle();
      expect(store.scope()).toBeNull();
      expect(router.url).not.toContain('barber=');
    },
  );
});

describe('StaffDayStore — ?view= (the contract-spelled dictionary)', () => {
  it('spells the views as the URL, the device and the page hooks do', () => {
    expect(StaffView).toEqual({
      Agenda: 'agenda',
      Day: 'day',
      ThreeDay: 'three-day',
      Week: 'week',
    });
    expect(parseView('three-day')).toBe(StaffView.ThreeDay);
    expect(parseView('month')).toBeNull();
    expect(parseView(null)).toBeNull();
    expect(parseView(undefined)).toBeNull();
  });

  // G-1 (pinned, no departure): SILENCE keeps the view the device restored
  // and states it in the address bar; an unknown name is not silence.
  it('keeps a restored week on a silent URL, and states it', async () => {
    const { store, router } = await build({ storedView: 'week' });
    expect(store.view()).toBe(StaffView.Week);
    store.applyRouteView(null);
    expect(store.view()).toBe(StaffView.Week);
    await settle();
    expect(router.url).toContain('view=week');
    expect(localStorage.getItem('staff.schedule.view')).toBe('week');
  });

  it('falls back to the agenda on a name nobody has, correcting the bar', async () => {
    const { store, router } = await build({ storedView: 'week' });
    store.applyRouteView(null);
    await settle();
    expect(router.url).toContain('view=week');
    // A pasted link names a view nobody has: the list, and the bar says so.
    await router.navigateByUrl('/?view=month');
    store.applyRouteView('month');
    expect(store.view()).toBe(StaffView.Agenda);
    await settle();
    expect(router.url).not.toContain('view=');
    expect(localStorage.getItem('staff.schedule.view')).toBe('agenda');
  });

  it('restores the agenda when the device remembers nothing it knows', async () => {
    const { store } = await build({ storedView: 'month' });
    expect(store.view()).toBe(StaffView.Agenda);
  });
});

describe('StaffDayStore — the zone of a shop, and now per shop', () => {
  const LONDON_SHOP = locationFixture({ id: LONDON, timeZone: LONDON_ZONE });

  it('reads a listed shop’s own zone, else the day’s', async () => {
    const { store } = await build({ shops: [CENTER_SHOP, LONDON_SHOP] });
    expect(store.zone()).toBe(FIXTURE_TIME_ZONE);
    expect(store.zoneAt()(LONDON)).toBe(LONDON_ZONE);
    expect(store.zoneAt()(CENTER)).toBe(FIXTURE_TIME_ZONE);
    expect(store.zoneAt()(LocationId.of('loc-unlisted'))).toBe(
      FIXTURE_TIME_ZONE,
    );
    expect(store.zoneAt()(null)).toBe(FIXTURE_TIME_ZONE);
  });

  it('judges each shop on its own clock, one ShopNow per zone per tick', async () => {
    const nowIso = '2026-08-05T00:30:00.000+03:00';
    const { store } = await build({
      nowIso,
      shops: [CENTER_SHOP, LONDON_SHOP],
    });
    const now = utcMs(nowIso);
    // 00:30 in Sofia is still the evening before in London.
    expect(store.shopNowAt()(LONDON)).toEqual(
      ZonedTimeSystem.shopNow(now, LONDON_ZONE),
    );
    expect(store.shopNowAt()(LONDON)?.localDate).toBe('2026-08-04');
    expect(store.shopNowAt()(CENTER)).toEqual(store.shopNow());
    // Two shops in one zone share the one reading.
    expect(store.shopNowAt()(CENTER)).toBe(
      store.shopNowAt()(LocationId.of('loc-unlisted')),
    );
  });

  it('knows no now before any zone is known', async () => {
    const { store } = await build({ shops: [], defaultShops: [] });
    expect(store.zone()).toBeNull();
    expect(store.todayKey()).toBeNull();
    expect(store.dayKey()).toBeNull();
    expect(store.visibleDays()).toEqual([]);
    expect(store.shopNowAt()(CENTER)).toBeNull();
  });
});

describe('StaffDayStore — the block write’s failure is a struct', () => {
  it('names the shop whose zone is unknown — and writes nothing', async () => {
    const { store } = await build({ shops: [], defaultShops: [] });
    const done = await store.blockTime(
      IVAN,
      CENTER,
      [],
      localDate('2026-08-05'),
    );
    expect(done).toBe(false);
    expect(store.absenceError()).toEqual({
      errorCode: CatalogErrorCode.LocationZoneUnknown,
      locationId: CENTER,
    });
    expect(store.absencePending()).toBe(false);
  });

  it('clears the failure on a write that lands', async () => {
    const { store } = await build();
    const done = await store.blockTime(
      IVAN,
      CENTER,
      [],
      localDate('2026-08-05'),
    );
    expect(done).toBe(true);
    expect(store.absenceError()).toBeNull();
  });
});

describe('StaffDayStore — the lanes carry the roster’s own minutes', () => {
  // DEP-10: a window opening inside Sofia's spring-forward gap (03:00 →
  // 04:00 on 2026-03-29) used to be drawn from the gap's END — the store
  // walked the minute to an instant and the sheet read it back as 04:00. The
  // lane now carries the roster's stored minute: 03:30.
  it('keeps a window that opens inside the spring-forward gap at its own minute', async () => {
    const sunday = localDate('2026-03-29');
    expect(LocalDate.weekday(sunday)).toBe(Weekday.Sun);
    const { store } = await build({
      nowIso: '2026-03-29T09:00:00.000+03:00',
      schedules: [
        barberScheduleFixture({
          id: IVAN,
          versions: [
            {
              seq: 1,
              effectiveFromLocalDate: localDate('2026-01-01'),
              effectiveToLocalDate: null,
              segments: [
                ShiftSegment.of(Weekday.Sun, CENTER, at(3, 30), until(12)),
              ],
            },
          ],
        }),
      ],
    });
    expect(store.dayKey()).toBe('2026-03-29');
    const lane = store.lanes().find((entry) => entry.barberId === IVAN);
    expect(
      lane?.rostered.map((range) => [range.startMinutes, range.endMinutes]),
    ).toEqual([[210, 720]]);
    expect(lane?.blocks).toEqual([]);
    // The holes are the system's, split at the shop's clock (09:00).
    expect(lane?.gaps.map((gap) => [gap.startMinutes, gap.endMinutes])).toEqual(
      [
        [210, 540],
        [540, 720],
      ],
    );
  });
});

describe('StaffDayStore — the team note’s append, one transaction', () => {
  const VISIT = AppointmentId.of('appointment-1');

  /**
   * A note bundle whose append transaction lands — deciding over no stored
   * note — or, with a `failure`, refuses without deciding anything.
   */
  function notesFailing(failure: RepositoryError | null) {
    const decided: (AppointmentNote | null)[] = [];
    const notes: AppointmentNotePorts = {
      observeAppointmentNote: () => of(Result.ok(null)),
      saveAppointmentNote: async () => Result.ok(undefined),
      updateAppointmentNote: async (_appointmentId, decide) => {
        if (failure !== null) return Result.err(failure);
        const next = decide(null);
        decided.push(next);
        return Result.ok(next);
      },
    };
    return { notes, decided };
  }

  it('answers true once the line is appended through the transaction', async () => {
    const world = notesFailing(null);
    const { store } = await build({ notes: world.notes });
    expect(await store.appendTeamNote(VISIT, '  наводнение ')).toBe(true);
    expect(world.decided.map((note) => note?.text)).toEqual(['наводнение']);
  });

  it('answers false when the transaction cannot reach the server — the sheet says so', async () => {
    const world = notesFailing(
      RepositoryError.writeFailed(
        'appointmentNotes/appointment-1',
        'unavailable',
      ),
    );
    const { store } = await build({ notes: world.notes });
    expect(await store.appendTeamNote(VISIT, 'наводнение')).toBe(false);
    expect(world.decided).toEqual([]);
  });
});
