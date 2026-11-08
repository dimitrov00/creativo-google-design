import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {} from '@creativo/infrastructure/firebase-app';
import {
  AppointmentId,
  BookingStatus,
  CouponGrantId,
  CouponId,
  CustomerId,
  GrantStatus,
  LocalDate,
  LocationId,
  PriceCents,
  Result,
  SeatId,
  type UtcEpochMs,
  Weekday,
} from '@core/primitives';
import {
  CatalogErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  type BookingCall,
  ClientIssueKind,
  Combinability,
  CouponExpiryRule,
  CouponStatus,
  CouponValue,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  ShiftSegment,
} from '@core/components';
import type { AppointmentNote, Coupon, CouponGrant } from '@core/entities';
import {
  type AppointmentNotePorts,
  type AppointmentReadPorts,
  Callables,
  type ClientIssuePorts,
  type IdPorts,
  type ObserveBarberDay,
} from '@core/ports';
import { CouponGrantSystem, ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  type GatewayCall,
  type GatewayScript,
  appointmentFixture,
  at,
  barberScheduleFixture,
  localDate,
  locationFixture,
  memoryCouponVoucherPorts,
  recordingClientIssuePorts,
  unwrapOk,
  until,
  utcMs,
} from '@core/testing';
import { ScheduleStatusFilter } from './schedule-status-filter';
import { type StaffDayStore, StaffView, parseView } from './staff-day.store';
import {
  CENTER,
  CENTER_SHOP,
  IVAN,
  buildStaffDayStore as build,
  settleStaffDayStore as settle,
} from './staff-day-store.spec-support';

/*
 * THE STAFF DAY STORE, at its own edges (pass D) — the route's `?day=`,
 * `?barber=` and `?view=` read once into their brands, the zone of a shop
 * in scope and "now" per shop, the block writes' failure as a struct, and
 * the lanes carrying the roster's own wall-clock minutes. The page drives
 * all of it through the dashboard; these are the store's answers alone.
 * Clocks are pinned (`memoryClockPorts`), never the wall clock.
 */

const LONDON = LocationId.of('loc-london');
const LONDON_ZONE = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));

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

describe('StaffDayStore — ?free=1 read once (staff-analytics CUJ 2)', () => {
  it('draws free time for this visit, stores nothing, and takes the parameter out of the URL', async () => {
    const { store, router } = await build({
      url: '/?day=2026-08-07&view=agenda&barber=ivan&free=1',
    });
    const filter = TestBed.inject(ScheduleStatusFilter);
    store.applyRouteDay('2026-08-07');
    store.applyRouteBarber('ivan');
    store.applyRouteFree('1');
    expect(filter.freeTimeShown()).toBe(true);
    expect(filter.storedFreeTimeShown()).toBe(false);
    await settle();
    expect(router.url).not.toContain('free=');
    expect(router.url).toContain('day=2026-08-07');
    expect(router.url).toContain('barber=ivan');
    expect(localStorage.getItem('staff-schedule-show-free-time')).toBeNull();
  });

  it('takes any other value out of the URL too, drawing nothing more', async () => {
    const { store, router } = await build({ url: '/?free=yes' });
    store.applyRouteFree('yes');
    expect(TestBed.inject(ScheduleStatusFilter).freeTimeShown()).toBe(false);
    await settle();
    expect(router.url).not.toContain('free=');
  });

  it('asks nothing when the URL is silent', async () => {
    const { store, router } = await build({ url: '/?day=' });
    store.applyRouteFree(null);
    store.applyRouteFree(undefined);
    await settle();
    expect(router.url).toBe('/?day=');
  });

  it('ends the one-off when the schedule is left', async () => {
    const { store } = await build();
    const filter = TestBed.inject(ScheduleStatusFilter);
    store.applyRouteFree('1');
    expect(filter.freeTimeShown()).toBe(true);
    TestBed.resetTestingModule();
    expect(filter.freeTimeShown()).toBe(false);
  });
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
              breaks: [],
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
    // The hole is the system's, WHOLE whatever the shop's clock (09:00 —
    // owner, 2026-11-05); what opens from it starts at now's tick.
    expect(lane?.gaps.map((gap) => [gap.startMinutes, gap.endMinutes])).toEqual(
      [[210, 720]],
    );
    expect(lane?.gaps[0]?.openFromMinutes).toBe(540);
  });
});

describe('StaffDayStore — a chair whose day was not read in full (OR-2)', () => {
  /** Ivan rostered 09:00–18:00 on the fixture's Wednesday. */
  const ROSTERED = [
    barberScheduleFixture({
      id: IVAN,
      versions: [
        {
          seq: 1,
          effectiveFromLocalDate: localDate('2026-01-01'),
          effectiveToLocalDate: null,
          breaks: [],
          segments: [ShiftSegment.of(Weekday.Wed, CENTER, at(9), until(18))],
        },
      ],
    }),
  ];
  const failing: ObserveBarberDay = () =>
    of(Result.err(RepositoryError.malformed('appointments/bad', 'seats[0]')));

  it('carries the count of visits the read could not show — 1 of 3 dropped', async () => {
    const kept = [
      appointmentFixture({ id: AppointmentId.of('apt-1') }),
      appointmentFixture({ id: AppointmentId.of('apt-2') }),
    ];
    const { store } = await build({
      barberDay: () =>
        of(Result.ok({ appointments: kept, unreadableCount: 1 })),
    });
    const lane = store.lanes().find((entry) => entry.barberId === IVAN);
    expect(lane?.unreadable).toBe(1);
    expect(lane?.failed).toBe(false);
    expect(lane?.appointments).toBe(kept);
  });

  it('reads a clean day as nothing unread', async () => {
    const { store } = await build({ schedules: ROSTERED });
    const lane = store.lanes().find((entry) => entry.barberId === IVAN);
    expect(lane?.unreadable).toBe(0);
    expect(lane?.failed).toBe(false);
    // The contrast for the failed case below: a clean rostered day has holes.
    expect(lane?.gaps.length).toBeGreaterThan(0);
  });

  it('draws no gap on a failed chair — a hole from a list never read would sell held time', async () => {
    const { store } = await build({ schedules: ROSTERED, barberDay: failing });
    const lane = store.lanes().find((entry) => entry.barberId === IVAN);
    expect(lane?.failed).toBe(true);
    expect(lane?.unreadable).toBe(0);
    expect(lane?.appointments).toEqual([]);
    expect(lane?.rostered.length).toBeGreaterThan(0);
    expect(lane?.gaps).toEqual([]);
  });

  it('never lists a failed chair as off — an unrostered chair that read cleanly still is', async () => {
    const clean = await build();
    expect(clean.store.offToday()).toEqual([IVAN]);
    TestBed.resetTestingModule();
    const { store } = await build({ barberDay: failing });
    expect(store.lanes()[0]?.failed).toBe(true);
    expect(store.offToday()).toEqual([]);
  });
});

describe('StaffDayStore — the open visit’s saved bill grants (OR-13)', () => {
  const GEORGI = CustomerId.of('cus_georgi');
  const COUPON: Coupon = {
    id: CouponId.of('coupon-free-cut'),
    name: 'Безплатно подстригване',
    code: null,
    combinability: Combinability.Exclusive,
    usageLimit: null,
    couponStatus: CouponStatus.Enabled,
    couponOccasion: null,
    ...unwrapOk(CouponValue.percentOff(100)),
    ...CouponExpiryRule.never(),
  };
  const grant = (id: string): CouponGrant => ({
    id: CouponGrantId.of(id),
    customerId: GEORGI,
    holderUserId: null,
    couponId: COUPON.id,
    grantedAtUtcMs: utcMs('2026-08-01T09:00:00.000+03:00'),
    ...CouponValue.sliceOf(COUPON),
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.none(),
    ),
  });
  /** The grant a save burned — `USED`, so the usable list no longer holds it. */
  const SPENT = unwrapOk(
    CouponGrantSystem.burn(
      grant('grant-spent'),
      utcMs('2026-08-04T10:00:00.000+03:00'),
      'appointment:apt-1',
    ),
  );
  const HELD = grant('grant-held');

  it('offers the usable grants and the ones the saved bill already spent', async () => {
    expect(SPENT.grantStatus).toBe(GrantStatus.Used);
    const { store } = await build({
      couponsVouchers: memoryCouponVoucherPorts({
        grants: [SPENT, HELD],
        coupons: [COUPON],
      }),
    });
    store.probeGrants(GEORGI);
    await settle();
    expect(store.grants().map((option) => option.grantId)).toEqual([
      'grant-held',
    ]);
    // The open visit's bill names the burned grant: it shows on its card.
    store.probeGrants(GEORGI, [SPENT.id]);
    await settle();
    expect(store.grants().map((option) => option.grantId)).toEqual([
      'grant-held',
      'grant-spent',
    ]);
    store.probeGrants(null);
    await settle();
    expect(store.grants()).toEqual([]);
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

/*
 * WS-4.1 — every act the day sends goes out NAMED: an arrival, its undo, a
 * transition and a tip each carry an `operationId` minted here, per call (a
 * second tap is a second act: no unsettled-name memory for these verbs,
 * unlike the staff edit's), and a minted name the wire cannot carry is
 * refused on the row before anything goes out.
 */
describe('StaffDayStore — each act goes out named (WS-4.1)', () => {
  const VISIT = AppointmentId.of('appointment-1');
  const SEAT = SeatId.of('seat-1');

  /** A counted id source: `operation-000000000001`, `-…2`, … in call order. */
  function countedIds(): IdPorts {
    let n = 0;
    return { nextId: () => `operation-${String((n += 1)).padStart(12, '0')}` };
  }

  /** The four acts, each sent once for `appointment-1`. */
  const acts: readonly (readonly [
    string,
    (store: StaffDayStore) => Promise<boolean>,
    Record<string, unknown>,
  ])[] = [
    [
      Callables.MarkArrived,
      (store) => store.markArrived(VISIT),
      { appointmentId: VISIT },
    ],
    [
      Callables.ClearArrival,
      (store) => store.clearArrival(VISIT),
      { appointmentId: VISIT },
    ],
    [
      Callables.TransitionAppointment,
      (store) =>
        store.transition({
          appointmentId: VISIT,
          toBookingStatus: BookingStatus.NoShow,
          cancellationReason: null,
          seatId: SEAT,
        }),
      {
        appointmentId: VISIT,
        toBookingStatus: BookingStatus.NoShow,
        cancellationReason: null,
        seatId: SEAT,
      },
    ],
    [
      Callables.RecordSeatTip,
      (store) =>
        store.recordTip({
          appointmentId: VISIT,
          seatId: SEAT,
          amountCents: unwrapOk(PriceCents.of(500)),
        }),
      { appointmentId: VISIT, seatId: SEAT, amountCents: 500 },
    ],
  ];

  it.each(acts)(
    '%s carries its intent and a freshly minted operationId — a second tap a new one',
    async (callable, send, intent) => {
      const calls: GatewayCall[] = [];
      const { store } = await build({ ids: countedIds(), calls });

      // The scripted gateway answers PIPELINE_UNKNOWN: refused, or lost.
      expect(await send(store)).toBe(false);
      expect(await send(store)).toBe(false);

      expect(calls).toEqual([
        {
          callable,
          input: { ...intent, operationId: 'operation-000000000001' },
        },
        {
          callable,
          input: { ...intent, operationId: 'operation-000000000002' },
        },
      ]);
    },
  );

  it.each(acts)(
    '%s refuses a minted name the call cannot carry — nothing goes out, the row says why',
    async (_callable, send) => {
      const calls: GatewayCall[] = [];
      const { store } = await build({ ids: { nextId: () => 'short' }, calls });

      expect(await send(store)).toBe(false);

      expect(calls).toEqual([]);
      expect(store.errorFor(VISIT)).toEqual(
        PipelineError.bare(PipelineErrorCode.InvalidRequest),
      );
      expect(store.isPending(VISIT)).toBe(false);
    },
  );
});

describe('StaffDayStore — the search window reaches the horizon and stays fresh', () => {
  const EPOCH = utcMs('2026-08-05T09:00:00.000+03:00');

  /** A store whose clock the spec moves and whose window reads are counted. */
  async function windowed(
    options: {
      readonly answer?: Awaited<
        ReturnType<AppointmentReadPorts['searchAppointmentWindow']>
      >;
      readonly script?: GatewayScript;
      readonly issues?: ClientIssuePorts;
    } = {},
  ) {
    const reads: {
      from: UtcEpochMs;
      to: UtcEpochMs;
      now: UtcEpochMs;
      cap: number;
    }[] = [];
    let now = EPOCH;
    let answer =
      options.answer ?? Result.ok({ appointments: [], capped: false });
    const harness = await build({
      script: options.script,
      issues: options.issues,
      clock: { nowUtcMs: () => now },
      searchWindow: async (from, to, at, cap) => {
        reads.push({ from, to, now: at, cap });
        return answer;
      },
    });
    return {
      ...harness,
      reads,
      advanceMinutes: (minutes: number) => {
        now = utcMs(
          new Date(EPOCH + (now - EPOCH) + minutes * 60_000).toISOString(),
        );
      },
      answerWith: (next: typeof answer) => {
        answer = next;
      },
    };
  }

  it('reads the range once on the first opening: 60 days back to the end of the two-month horizon, in the shop’s zone', async () => {
    const { store, reads } = await windowed();

    await store.openSearch();

    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      from: utcMs('2026-06-06T00:00:00+03:00'),
      to: utcMs('2026-10-31T23:59:59.999+02:00'),
      now: EPOCH,
      cap: 3000,
    });
  });

  it('reads nothing when it is reopened inside 15 minutes with no visit written here', async () => {
    const { store, reads, advanceMinutes } = await windowed();

    await store.openSearch();
    store.closeSearch();
    advanceMinutes(14);
    await store.openSearch();
    await store.ensureWindow();

    expect(reads).toHaveLength(1);
  });

  it('reads again after 15 minutes, keeping the old window on screen meanwhile', async () => {
    const first = [appointmentFixture()];
    const { store, reads, advanceMinutes, answerWith } = await windowed({
      answer: Result.ok({ appointments: first, capped: false }),
    });
    await store.openSearch();
    advanceMinutes(15);
    answerWith(Result.ok({ appointments: [], capped: false }));

    const reloading = store.openSearch();
    expect(store.pool()).toEqual(first);
    await reloading;

    expect(reads).toHaveLength(2);
    expect(store.pool()).toEqual([]);
  });

  it('reads again after invalidateSearchWindow, once', async () => {
    const { store, reads } = await windowed();
    await store.openSearch();

    store.invalidateSearchWindow();
    await store.openSearch();
    await store.openSearch();

    expect(reads).toHaveLength(2);
  });

  const intent = {
    appointmentId: AppointmentId.of('visit-1'),
  } as unknown as BookingCall.TransitionIntent;

  it('does not invalidate on a refused transition', async () => {
    const { store, reads } = await windowed();
    await store.openSearch();

    await store.transition(intent);
    await store.openSearch();

    expect(reads).toHaveLength(1);
  });

  it('invalidates on a landed transition', async () => {
    const { store, reads } = await windowed({
      script: {
        [Callables.TransitionAppointment]: () => Result.ok(undefined as never),
      },
    });
    await store.openSearch();

    await store.transition(intent);
    await store.openSearch();

    expect(reads).toHaveLength(2);
  });

  it('reads again at once when a visit is written while the search is open, so the results say it', async () => {
    const before = [appointmentFixture()];
    const after = [appointmentFixture({ id: AppointmentId.of('visit-2') })];
    const { store, reads, answerWith } = await windowed({
      answer: Result.ok({ appointments: before, capped: false }),
      script: {
        [Callables.TransitionAppointment]: () => Result.ok(undefined as never),
      },
    });
    await store.openSearch();
    answerWith(Result.ok({ appointments: after, capped: false }));

    await store.transition(intent);
    await vi.waitFor(() => expect(store.pool()).toEqual(after));

    expect(reads).toHaveLength(2);
  });

  it('only marks the window when a visit is written with the search closed', async () => {
    const { store, reads } = await windowed({
      script: {
        [Callables.TransitionAppointment]: () => Result.ok(undefined as never),
      },
    });
    await store.openSearch();
    store.closeSearch();

    await store.transition(intent);
    expect(reads).toHaveLength(1);
    await store.openSearch();
    expect(reads).toHaveLength(2);
  });

  it('keeps the window and says it may be out of date when a refresh fails', async () => {
    const first = [appointmentFixture()];
    const { store, advanceMinutes, answerWith } = await windowed({
      answer: Result.ok({ appointments: first, capped: false }),
    });
    await store.openSearch();
    advanceMinutes(20);
    answerWith(Result.err(RepositoryError.readFailed('appointments', null)));

    await store.openSearch();

    expect(store.pool()).toEqual(first);
    expect(store.searchStale()).toBe(true);
  });

  it('clears the out-of-date note when the next refresh lands', async () => {
    const { store, advanceMinutes, answerWith } = await windowed();
    await store.openSearch();
    advanceMinutes(20);
    answerWith(Result.err(RepositoryError.readFailed('appointments', null)));
    await store.openSearch();
    answerWith(Result.ok({ appointments: [], capped: false }));

    await store.openSearch();

    expect(store.searchStale()).toBe(false);
  });

  it('carries the cap flag of the window it read', async () => {
    const { store } = await windowed({
      answer: Result.ok({ appointments: [], capped: true }),
    });

    await store.openSearch();

    expect(store.searchCapped()).toBe(true);
  });

  it('reports a capped window once as a SEARCH_WINDOW_CAPPED issue that names no person and no document', async () => {
    const { ports, reported } = recordingClientIssuePorts();
    const { store } = await windowed({
      answer: Result.ok({ appointments: [], capped: true }),
      issues: ports,
    });

    await store.openSearch();

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      clientIssueKind: ClientIssueKind.SearchWindowCapped,
      occurrences: 1,
      documentPath: null,
      fieldName: null,
      scrubbedMessage: null,
      topFrame: null,
    });
  });

  it('reports nothing when the window was read whole', async () => {
    const { ports, reported } = recordingClientIssuePorts();
    const { store } = await windowed({ issues: ports });

    await store.openSearch();

    expect(reported).toHaveLength(0);
  });

  it('keeps the window it read when the issue sink throws', async () => {
    const first = [appointmentFixture()];
    const { store } = await windowed({
      answer: Result.ok({ appointments: first, capped: true }),
      issues: {
        reportClientIssues: () => {
          throw new Error('sink down');
        },
      },
    });

    await store.openSearch();

    expect(store.pool()).toEqual(first);
    expect(store.searchStale()).toBe(false);
  });

  it('shares one read between two callers that open it together', async () => {
    const { store, reads } = await windowed();

    await Promise.all([store.openSearch(), store.ensureWindow()]);

    expect(reads).toHaveLength(1);
  });
});
