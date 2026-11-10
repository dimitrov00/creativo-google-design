import { describe, expect, it } from 'vitest';
import {
  type AnalyticsCall,
  type AnalyticsReport,
  AnalyticsBarPart,
  AnalyticsComparison,
  AnalyticsFigure,
  type AnalyticsGoal,
  AnalyticsPeriod,
  AnalyticsSpan,
  GoalPaceTag,
  HeroChange,
  BookingLifecycle,
  BookingOrigin,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  ClientStatsPolicy,
  DayFigures,
  LocationStatus,
  MinuteRange,
  Placement,
  RadarBase,
  Role,
  Seat,
  SeatOutcome,
  type ShopNow,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  Currency,
  LocalDate,
  LocationId,
  MinuteCount,
  MonthKey,
  type PriceCents,
  ScheduleExceptionId,
  SeatId,
  ServiceId,
  UserId,
  UtcEpochMs,
  Weekday,
  CustomerId,
} from '@core/primitives';
import {
  ANALYTICS_FIXTURE_LOCATIONS,
  ANALYTICS_FIXTURE_SHOPS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  analyticsFixtureDayDocuments,
  analyticsReportFixture,
  appointmentFixture,
  barberScheduleFixture,
  blockedUserFixture,
  deepFreeze,
  endMinute,
  localDate,
  locationFixture,
  minute,
  registeredUserFixture,
  scheduleExceptionFixture,
  seatFixture,
  termsFixture,
} from '@core/testing';
import { AnalyticsRadarSystem } from './analytics-radar.system';
import type { ChairDay } from './chair-time.system';
import {
  type AnalyticsDay,
  type AnalyticsDaysInput,
  type AnalyticsFollowUp,
  type AnalyticsInput,
  type AnalyticsVisit,
  StaffAnalyticsSystem,
} from './staff-analytics.system';

const S = StaffAnalyticsSystem;
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const cut = ServiceId.of('svc-cut');
const beard = ServiceId.of('svc-beard');
const stamp = FIXTURE_NOW_UTC_MS;
/** Today: Wednesday 14 October 2026, 14:00. */
const TODAY = localDate('2026-10-14');
const NOW: ShopNow = {
  localDate: TODAY,
  currentMinute: minute(14 * 60),
  utcEpochMs: stamp,
};
const OCTOBER = AnalyticsPeriod.monthOf(TODAY);
const day = (n: number): LocalDate => LocalDate.addDays(TODAY, n);

let seatSeq = 0;
const seat = (
  barberId: BarberId,
  priceCents: number,
  outcome: SeatOutcome = SeatOutcome.worked(stamp),
  serviceId: ServiceId = cut,
  startHour = 10,
  tipCents: number | null = null,
): Seat =>
  seatFixture({
    seatId: SeatId.of(`s-${++seatSeq}`),
    barberId,
    serviceId,
    startMinutes: minute(startHour * 60),
    tipCents: tipCents as Seat['tipCents'],
    terms: Seat.termsOf(termsFixture(priceCents, 30, 0, 0), null),
    outcome,
  });

const visit = (
  id: string,
  localDay: LocalDate,
  seats: readonly Seat[],
  extra: Partial<AnalyticsVisit> = {},
): AnalyticsVisit =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDay,
    seats,
    ...extra,
  } as Parameters<typeof appointmentFixture>[0]);

const zero = 0 as MinuteCount;
const NO_LOCATIONS: readonly LocationId[] = [];

const dayOf = (
  barberId: BarberId,
  localDay: LocalDate,
  parts: Partial<Record<keyof ChairDay, number>> = {},
  stretches: readonly MinuteRange[] = [],
): AnalyticsDay =>
  ({
    barberId,
    localDate: localDay,
    stretches,
    // One shop, one clock: past two days back (Terms, «Past day»).
    pastDay: LocalDate.addDays(localDay, 1) < TODAY,
    rosteredMinutes: zero,
    workedMinutes: zero,
    noShowMinutes: zero,
    unmarkedMinutes: zero,
    bookedAheadMinutes: zero,
    heldMinutes: zero,
    blockedMinutes: zero,
    breakMinutes: zero,
    shortGapMinutes: zero,
    unsoldMinutes: zero,
    openMinutes: zero,
    pastBlockedMinutes: zero,
    pastHeldMinutes: zero,
    pastShortGapMinutes: zero,
    outsideHoursMinutes: zero,
    outsideHoursSeatCount: 0,
    closedDayMinutes: zero,
    locationIds: NO_LOCATIONS,
    ...parts,
  }) as AnalyticsDay;

function input(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    scopeBarberIds: [ivan],
    scopeLocationIds: [],
    barberIds: [ivan],
    period: OCTOBER,
    analyticsComparison: AnalyticsComparison.Previous,
    days: [],
    pastDays: [],
    aheadDays: [],
    visits: [],
    previousVisits: [],
    previousPastDays: [],
    followUps: [],
    firstSeen: [],
    policy: ClientStatsPolicy.DEFAULT,
    now: NOW,
    goal: null,
    locationFigures: [],
    ...overrides,
  };
}

describe('AnalyticsPeriod', () => {
  it('builds Monday weeks and calendar months', () => {
    expect(AnalyticsPeriod.weekOf(TODAY)).toEqual({
      analyticsSpan: 'WEEK',
      fromLocalDate: '2026-10-12',
      toLocalDate: '2026-10-18',
    });
    expect(OCTOBER).toEqual({
      analyticsSpan: 'MONTH',
      fromLocalDate: '2026-10-01',
      toLocalDate: '2026-10-31',
    });
    expect(AnalyticsPeriod.length(OCTOBER)).toBe(31);
    expect(AnalyticsPeriod.previous(OCTOBER).toLocalDate).toBe('2026-09-30');
  });

  it('refuses a period whose first day is not a Monday or a 1st', () => {
    expect(
      AnalyticsPeriod.of(AnalyticsSpan.Week, localDate('2026-10-12'), null).ok,
    ).toBe(true);
    expect(AnalyticsPeriod.of(AnalyticsSpan.Week, TODAY, null)).toEqual({
      ok: false,
      error: { errorCode: 'ANALYTICS_INVALID_INPUT', field: 'fromLocalDate' },
    });
    expect(
      AnalyticsPeriod.of(AnalyticsSpan.Month, localDate('2026-10-02'), null).ok,
    ).toBe(false);
  });

  it('reaches 12 months back and no further, and never past today', () => {
    expect(
      AnalyticsPeriod.isWithinRange(
        AnalyticsPeriod.monthOf(localDate('2025-10-01')),
        TODAY,
      ),
    ).toBe(true);
    expect(
      AnalyticsPeriod.isWithinRange(
        AnalyticsPeriod.monthOf(localDate('2025-09-01')),
        TODAY,
      ),
    ).toBe(false);
    expect(
      AnalyticsPeriod.isWithinRange(
        AnalyticsPeriod.monthOf(localDate('2026-11-01')),
        TODAY,
      ),
    ).toBe(false);
  });
});

describe('StaffAnalyticsSystem.scopeOf — the visibility table', () => {
  const request = (
    asked: BarberId | readonly BarberId[] | null,
  ): AnalyticsCall => ({
    scopeBarberIds:
      asked === null ? [] : typeof asked === 'string' ? [asked] : asked,
    scopeLocationIds: [],
    fromLocalDate: OCTOBER.fromLocalDate,
    toLocalDate: null,
    analyticsSpan: AnalyticsSpan.Month,
    analyticsComparison: AnalyticsComparison.Previous,
  });
  const known = [ivan, niko];
  const caller = (
    roles: readonly Role[],
    linkedBarberId: BarberId | null = null,
    blocked = false,
  ) => ({ callerRoles: roles, callerBlocked: blocked, linkedBarberId });

  it.each([
    [
      'a blocked admin',
      caller([Role.Admin], null, true),
      null,
      'ANALYTICS_FORBIDDEN',
    ],
    ['an admin asking for the shop', caller([Role.Admin]), null, null],
    ['an admin asking for a barber', caller([Role.Admin]), niko, niko],
    [
      'an admin who is also a barber, asking for the shop',
      caller([Role.Barber, Role.Admin], ivan),
      null,
      null,
    ],
    [
      'an admin asking for an unknown id',
      caller([Role.Admin]),
      BarberId.of('ghost'),
      'ANALYTICS_SCOPE_UNKNOWN',
    ],
    [
      'a linked barber asking for their own',
      caller([Role.Barber], ivan),
      null,
      ivan,
    ],
    [
      'a linked barber naming their own',
      caller([Role.Barber], ivan),
      ivan,
      ivan,
    ],
    [
      'a linked barber asking for a colleague',
      caller([Role.Barber], ivan),
      niko,
      'ANALYTICS_FORBIDDEN',
    ],
    [
      'a barber not linked',
      caller([Role.Barber]),
      null,
      'ANALYTICS_BARBER_NOT_LINKED',
    ],
    [
      'a receptionist',
      caller([Role.Receptionist]),
      null,
      'ANALYTICS_FORBIDDEN',
    ],
    ['the sysadmin', caller([Role.Sysadmin]), null, 'ANALYTICS_FORBIDDEN'],
    [
      'an admin asking for a part of the team, named twice and out of order',
      caller([Role.Admin]),
      [niko, ivan, niko],
      [ivan, niko],
    ],
    [
      'a linked barber naming themselves and a colleague',
      caller([Role.Barber], ivan),
      [ivan, niko],
      'ANALYTICS_FORBIDDEN',
    ],
  ] as const)('%s', (_, who, asked, expected) => {
    const result = S.scopeOf(who, request(asked), known);
    if (typeof expected === 'string' && expected.startsWith('ANALYTICS_')) {
      expect(result.ok ? null : result.error.errorCode).toBe(expected);
    } else {
      // The shop is none named; one record is that barber's own report.
      const value =
        expected === null
          ? []
          : typeof expected === 'string'
            ? [expected]
            : expected;
      expect(result).toEqual({ ok: true, value });
    }
  });
});

describe('StaffAnalyticsSystem — the location scope (ADR 2026-11-09)', () => {
  const centre = ANALYTICS_FIXTURE_SHOPS.centre;
  const mladost = ANALYTICS_FIXTURE_SHOPS.mladost;
  const admin = {
    callerRoles: [Role.Admin],
    callerBlocked: false,
    linkedBarberId: null,
  };

  it('locationScopeOf: none named is every location; an admin may name shops of the shop’s, beside barbers too', () => {
    const ask = (...scopeLocationIds: LocationId[]) => ({ scopeLocationIds });
    const shops = ANALYTICS_FIXTURE_LOCATIONS;
    expect(S.locationScopeOf(admin, ask(), shops)).toEqual({
      ok: true,
      value: [],
    });
    expect(S.locationScopeOf(admin, ask(centre), shops)).toEqual({
      ok: true,
      value: [centre],
    });
    // Sorted, each once.
    expect(
      S.locationScopeOf(admin, ask(mladost, centre, mladost), shops),
    ).toEqual({ ok: true, value: [centre, mladost].sort() });
    const ghost = LocationId.of('loc-ghost');
    expect(S.locationScopeOf(admin, ask(centre, ghost), shops)).toEqual({
      ok: false,
      error: { errorCode: 'ANALYTICS_LOCATION_UNKNOWN', locationId: ghost },
    });
    for (const who of [
      { ...admin, callerBlocked: true },
      { ...admin, callerRoles: [Role.Barber], linkedBarberId: ivan },
    ]) {
      expect(S.locationScopeOf(who, ask(centre), shops)).toEqual({
        ok: false,
        error: { errorCode: 'ANALYTICS_FORBIDDEN' },
      });
    }
  });

  it('comparedLocationsOf: the named shops, or every one, when two or more — for an admin only', () => {
    const shops = ANALYTICS_FIXTURE_LOCATIONS;
    const all = shops.map((shop) => shop.id);
    expect(S.comparedLocationsOf(admin, [], shops)).toEqual(all);
    expect(S.comparedLocationsOf(admin, [centre, mladost], shops)).toEqual([
      centre,
      mladost,
    ]);
    expect(S.comparedLocationsOf(admin, [centre], shops)).toEqual([]);
    expect(
      S.comparedLocationsOf(
        { ...admin, callerRoles: [Role.Barber], linkedBarberId: ivan },
        [],
        shops,
      ),
    ).toEqual([]);
  });

  it('atLocations and visitsAt keep those shops’ hours and the visits booked there; none keeps everything', () => {
    const at = (id: LocationId, n: string) =>
      appointmentFixture({ id: AppointmentId.of(n), locationId: id });
    const visits = [at(centre, 'a-1'), at(mladost, 'a-2')];
    const input: AnalyticsDaysInput = {
      barberIds: [ivan],
      localDates: [],
      rosters: [],
      departures: [],
      locations: ANALYTICS_FIXTURE_LOCATIONS,
      visits,
      nowByLocation: [],
      now: NOW,
    };
    expect(S.atLocations(input, [])).toBe(input);
    const cut = S.atLocations(deepFreeze(input), [mladost]);
    expect(cut.locations.map((l) => l.id)).toEqual([mladost]);
    expect(cut.visits.map((v) => v.id)).toEqual(['a-2']);
    expect(S.visitsAt(visits, [centre]).map((v) => v.id)).toEqual(['a-1']);
    expect(S.visitsAt(visits, [centre, mladost]).map((v) => v.id)).toEqual([
      'a-1',
      'a-2',
    ]);
    expect(S.visitsAt(visits, [])).toBe(visits);
  });

  it('a stored day lists the shops it touched, and a split day’s shares add up to it', () => {
    const documents = analyticsFixtureDayDocuments();
    const split = documents.filter((day) => day.dayLocations.length >= 2);
    expect(split.length).toBeGreaterThan(0);
    for (const day of documents) {
      expect([...day.dayLocationIds].sort()).toEqual(day.dayLocationIds);
    }
    for (const day of split) {
      const sum = (pick: (body: (typeof day.dayLocations)[number]) => number) =>
        day.dayLocations.reduce((total, share) => total + pick(share), 0);
      expect(sum((d) => d.dayTakingsCents)).toBe(day.dayTakingsCents);
      expect(sum((d) => d.dayWorkedMinutes)).toBe(day.dayWorkedMinutes);
      expect(sum((d) => d.dayRosteredMinutes)).toBe(day.dayRosteredMinutes);
    }
  });

  it('storedAt answers one day per stored day — the share, the lone day, or an empty held day', () => {
    const documents = analyticsFixtureDayDocuments();
    const at = S.storedAt(documents, [mladost]);
    expect(at).toHaveLength(documents.length);
    expect(S.storedAt(documents, [])).toBe(documents);
    for (let i = 0; i < documents.length; i++) {
      const day = documents[i];
      const cut = at[i];
      if (day === undefined || cut === undefined) throw new Error('length');
      expect(cut.barberId).toBe(day.barberId);
      expect(cut.localDate).toBe(day.localDate);
      if (!day.dayLocationIds.includes(mladost)) {
        expect(cut.dayTakingsCents).toBe(0);
        expect(cut.dayRosteredMinutes).toBe(0);
      }
    }
  });

  it('storedAt over several shops sums their shares — every shop named is the whole day', () => {
    const documents = analyticsFixtureDayDocuments();
    const both = S.storedAt(documents, Object.values(ANALYTICS_FIXTURE_SHOPS));
    for (let i = 0; i < documents.length; i++) {
      const day = documents[i];
      const cut = both[i];
      if (day === undefined || cut === undefined) throw new Error('length');
      expect(cut.dayTakingsCents).toBe(day.dayTakingsCents);
      expect(cut.dayWorkedMinutes).toBe(day.dayWorkedMinutes);
      expect(cut.dayRosteredMinutes).toBe(day.dayRosteredMinutes);
      expect(cut.dayComputedAtUtcMs).toBe(day.dayComputedAtUtcMs);
    }
  });
});

describe('StaffAnalyticsSystem.report — the catalogue', () => {
  it('sums takings after the discount split, and tips, from worked seats only', () => {
    const report = S.report(
      input({
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, undefined, cut, 10, 300)]),
          visit('a2', day(-2), [
            seat(ivan, 2000),
            seat(niko, 2000, SeatOutcome.noShow(stamp)),
          ]),
        ],
      }),
    );
    expect(report.reportTakingsCents).toBe(4000);
    expect(report.reportTipsCents).toBe(300);
    expect(report.reportNoShowCount).toBe(0);
    expect(report.reportNoShowBase).toBe(2);
  });

  it('counts rebooked visits whose window has ended, by the end of the next shop day', () => {
    const followUps: AnalyticsFollowUp[] = [
      // a1 (day −5) rebooked the next day: counts.
      {
        bookedFromAppointmentId: AppointmentId.of('a1'),
        bookedOnLocalDate: day(-4),
        followUpCancelled: false,
      },
      // a2 (day −5) rebooked two days later: does not.
      {
        bookedFromAppointmentId: AppointmentId.of('a2'),
        bookedOnLocalDate: day(-3),
        followUpCancelled: false,
      },
      // a3 (day −5) rebooked, then cancelled: does not.
      {
        bookedFromAppointmentId: AppointmentId.of('a3'),
        bookedOnLocalDate: day(-5),
        followUpCancelled: true,
      },
      // a4 (yesterday) rebooked: its window is still open — out of the base.
      {
        bookedFromAppointmentId: AppointmentId.of('a4'),
        bookedOnLocalDate: day(-1),
        followUpCancelled: false,
      },
    ];
    const report = S.report(
      input({
        visits: [
          visit('a1', day(-5), [seat(ivan, 2000)]),
          visit('a2', day(-5), [seat(ivan, 2000)]),
          visit('a3', day(-5), [seat(ivan, 2000)]),
          visit('a4', day(-1), [seat(ivan, 2000)]),
        ],
        followUps,
      }),
    );
    expect(report.reportRebookedCount).toBe(1);
    expect(report.reportRebookedBase).toBe(3);
    // Below the base of 20: counts only.
    expect(report.reportRebookedRate).toBeNull();
    const rows = S.seatRowsFor(report, AnalyticsFigure.Rebooked, {
      serviceId: null,
      localDate: null,
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.seatRebooked === true)).toHaveLength(1);
  });

  it('shows a rate only from a base of 20', () => {
    const at = (n: number, noShow: boolean) =>
      visit(`v${n}`, day(-2), [
        seat(ivan, 1000, noShow ? SeatOutcome.noShow(stamp) : undefined),
      ]);
    const nineteen = Array.from({ length: 19 }, (_, i) => at(i, i < 2));
    expect(S.report(input({ visits: nineteen })).reportNoShowRate).toBeNull();
    const twenty = [...nineteen, at(19, false)];
    expect(S.report(input({ visits: twenty })).reportNoShowRate).toBe(2 / 20);
  });

  it('counts a late client cancellation with the client card’s rule', () => {
    const late = SeatOutcome.cancelled(
      // An hour before the visit: inside the default window.
      UtcEpochMs.plusMs(stamp, -60 * 60 * 1000),
      CancelledBy.Client,
      CancellationReason.ClientChangedPlans,
      null,
    );
    const shop = SeatOutcome.cancelled(
      UtcEpochMs.plusMs(stamp, -60 * 60 * 1000),
      CancelledBy.Staff,
      CancellationReason.StaffShopClosure,
      null,
    );
    const lifecycle = BookingLifecycle.cancel(
      stamp,
      CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
    );
    const report = S.report(
      input({
        visits: [
          visit('c1', day(-2), [seat(ivan, 2000, late)], {
            utcEpochMs: stamp,
            ...lifecycle,
          }),
          visit('c2', day(-2), [seat(ivan, 2000, shop)], {
            utcEpochMs: stamp,
            ...lifecycle,
          }),
        ],
      }),
    );
    expect(report.reportLateCancellationCount).toBe(1);
  });

  it('compares the hero over the same elapsed days, counting a seat once it has ended', () => {
    // Today, the 14th at 14:00: October 1–14 against September 1–14.
    const report = S.report(
      input({
        visits: [
          visit('o1', day(-1), [seat(ivan, 3000)]),
          // Today at 13:00 (ended 13:30): counts.
          visit('o2', TODAY, [seat(ivan, 1000, undefined, cut, 13)]),
          // Today at 15:00 — marked worked early, not yet ended: left out of the hero.
          visit('o3', TODAY, [seat(ivan, 500, undefined, cut, 15)]),
        ],
        previousVisits: [
          visit('p1', localDate('2026-09-10'), [seat(ivan, 2000)]),
          // September 14th at 15:00: past the cut minute of the counterpart day.
          visit('p2', localDate('2026-09-14'), [
            seat(ivan, 700, undefined, cut, 15),
          ]),
          // September 20th: after the compared days.
          visit('p3', localDate('2026-09-20'), [seat(ivan, 9000)]),
        ],
      }),
    );
    expect(report.reportHeroCurrentCents).toBe(4000);
    expect(report.reportHeroPreviousCents).toBe(2000);
    expect(report.reportTakingsCents).toBe(4500);
  });

  it('says there is no previous period when it held no worked seat in scope', () => {
    const report = S.report(input());
    expect(report.reportHeroPreviousCents).toBeNull();
    // The comparison period is still named: October is comparable.
    expect(report.reportAnalyticsComparison).toBe(AnalyticsComparison.Previous);
    expect(report.reportComparisonFromLocalDate).toBe('2026-09-01');
    expect(report.reportComparisonToLocalDate).toBe('2026-09-30');
  });

  it('reports a DAY: one point, one bar, the hero against the same weekday a week earlier up to now', () => {
    // Today, Wednesday the 14th at 14:00, against Wednesday the 7th.
    const report = S.report(
      input({
        period: AnalyticsPeriod.dayOf(TODAY),
        visits: [
          // 10:00, ended: in the takings and the hero.
          visit('d1', TODAY, [seat(ivan, 3000)]),
          // 15:00, marked worked early, not yet ended: takings, not the hero.
          visit('d2', TODAY, [seat(ivan, 500, undefined, cut, 15)]),
        ],
        previousVisits: [
          visit('p1', day(-7), [seat(ivan, 2000)]),
          // The counterpart day at 15:00: past the cut minute — the line
          // counts it, the hero does not.
          visit('p2', day(-7), [seat(ivan, 700, undefined, cut, 15)]),
          // Another day: outside the counterpart.
          visit('p3', day(-6), [seat(ivan, 9000)]),
        ],
        days: [dayOf(ivan, TODAY, { rosteredMinutes: 540, workedMinutes: 60 })],
      }),
    );
    expect(report.reportAnalyticsSpan).toBe(AnalyticsSpan.Day);
    expect(report.reportFromLocalDate).toBe(TODAY);
    expect(report.reportToLocalDate).toBe(TODAY);
    expect(report.reportComparisonFromLocalDate).toBe(day(-7));
    expect(report.reportComparisonToLocalDate).toBe(day(-7));
    expect(report.reportSeries).toMatchObject([
      {
        localDate: TODAY,
        takingsCents: 3500,
        tipsCents: 0,
        comparisonTakingsCents: 2700,
      },
    ]);
    expect(report.reportTimeSeries).toHaveLength(1);
    expect(report.reportTimeSeries[0]).toMatchObject({
      localDate: TODAY,
      workedMinutes: 60,
    });
    expect(report.reportTakingsCents).toBe(3500);
    expect(report.reportHeroCurrentCents).toBe(3000);
    expect(report.reportHeroPreviousCents).toBe(2000);

    // A past day: whole against whole.
    const past = S.report(
      input({
        period: AnalyticsPeriod.dayOf(day(-3)),
        visits: [visit('q1', day(-3), [seat(ivan, 500, undefined, cut, 15)])],
        previousVisits: [
          visit('q2', day(-10), [seat(ivan, 700, undefined, cut, 15)]),
        ],
      }),
    );
    expect(past.reportHeroCurrentCents).toBe(500);
    expect(past.reportHeroPreviousCents).toBe(700);
    expect(past.reportSeries).toHaveLength(1);
  });

  it('states no comparison when the comparison period starts before the reach', () => {
    // On 14 October 2026 the reach starts 1 October 2025: October 2025 is
    // in range, its comparison (September) is not.
    const edge = AnalyticsPeriod.monthOf(localDate('2025-10-01'));
    const report = S.report(
      input({
        period: edge,
        visits: [visit('e', localDate('2025-10-03'), [seat(ivan, 1000)])],
        // Handed in by mistake: never counted.
        previousVisits: [
          visit('x', localDate('2025-09-03'), [seat(ivan, 500)]),
        ],
      }),
    );
    expect(report.reportAnalyticsComparison).toBe(AnalyticsComparison.Previous);
    expect(report.reportComparisonFromLocalDate).toBeNull();
    expect(report.reportComparisonToLocalDate).toBeNull();
    expect(report.reportHeroPreviousCents).toBeNull();
    expect(report.reportHeroCurrentCents).toBe(1000);
    expect(report.reportSeries).toHaveLength(31);
    expect(
      report.reportSeries.every((p) => p.comparisonTakingsCents === null),
    ).toBe(true);
    expect(S.heroChangeOf(report).heroChange).toBe(HeroChange.None);
  });

  it('ranks services by takings and states takings per hour of service', () => {
    const report = S.report(
      input({
        visits: [
          visit('s1', day(-2), [seat(ivan, 3000, undefined, cut)]),
          visit('s2', day(-2), [seat(ivan, 1500, undefined, beard)]),
          visit('s3', day(-1), [seat(ivan, 3000, undefined, cut)]),
        ],
      }),
    );
    expect(report.reportServices).toEqual([
      {
        serviceId: cut,
        workedSeatCount: 2,
        takingsCents: 6000,
        serviceMinutes: 60,
        takingsPerHourCents: 6000,
      },
      {
        serviceId: beard,
        workedSeatCount: 1,
        takingsCents: 1500,
        serviceMinutes: 30,
        takingsPerHourCents: 3000,
      },
    ]);
  });

  it('splits visits by booking origin', () => {
    const report = S.report(
      input({
        visits: [
          visit('o1', day(-2), [seat(ivan, 1000)], {
            placement: Placement.Self,
          }),
          visit('o2', day(-2), [seat(ivan, 1000)], {
            placement: Placement.Staff,
          }),
          visit('o3', day(-2), [seat(ivan, 1000)], { placement: null }),
        ],
      }),
    );
    expect(report.reportOrigins).toEqual([
      { bookingOrigin: BookingOrigin.Online, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Staff, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Unknown, visitCount: 1 },
    ]);
  });

  it('fills weekdays from past days only: (worked + no-show + unmarked) ÷ (rostered − break)', () => {
    const report = S.report(
      input({
        days: [
          // Monday 12th: 8 h rostered, 30 min break, 5 h worked, 30 min no-show.
          dayOf(ivan, day(-2), {
            rosteredMinutes: 480,
            breakMinutes: 30,
            workedMinutes: 300,
            noShowMinutes: 30,
          }),
          // Today is not a past day.
          dayOf(ivan, TODAY, { rosteredMinutes: 480, workedMinutes: 480 }),
        ],
      }),
    );
    expect(report.reportWeekdayFill).toEqual([
      {
        weekday: 1,
        filledMinutes: 330,
        capacityMinutes: 450,
        fillRate: 330 / 450,
      },
    ]);
  });

  it('sums the time parts, and draws the bar up to now with held time and short gaps as one “other”', () => {
    const report = S.report(
      input({
        days: [
          dayOf(ivan, day(-1), {
            rosteredMinutes: 600,
            workedMinutes: 300,
            unsoldMinutes: 200,
            blockedMinutes: 60,
            pastBlockedMinutes: 60,
            heldMinutes: 30,
            pastHeldMinutes: 30,
            shortGapMinutes: 10,
            pastShortGapMinutes: 10,
          }),
          dayOf(ivan, TODAY, {
            rosteredMinutes: 600,
            workedMinutes: 120,
            unsoldMinutes: 60,
            blockedMinutes: 60,
            pastBlockedMinutes: 0,
            openMinutes: 360,
          }),
        ],
      }),
    );
    expect(report.reportRosteredMinutes).toBe(1200);
    expect(report.reportBarWorkedMinutes).toBe(420);
    expect(report.reportBarBlockedMinutes).toBe(60);
    expect(report.reportBarOtherMinutes).toBe(40);
    expect(report.reportOpenMinutes).toBe(360);
    expect(report.reportDayRows).toHaveLength(2);
    // v2: the rows carry the `day*` parts, as a stored day does.
    expect(report.reportDayRows[0]).toMatchObject({
      barberId: ivan,
      localDate: day(-1),
      dayRosteredMinutes: 600,
      dayWorkedMinutes: 300,
      dayUnsoldMinutes: 200,
      dayOpenMinutes: 0,
    });
    expect(report.reportDayRows[1]?.dayOpenMinutes).toBe(360);
  });

  it('carries each day’s money on its row (v2): the rows’ takings and tips sum to the report’s', () => {
    const report = S.report(
      input({
        days: [dayOf(ivan, day(-3)), dayOf(ivan, day(-2))],
        visits: [
          visit('a1', day(-3), [seat(ivan, 2000, undefined, cut, 10, 300)]),
          visit('a2', day(-2), [
            seat(ivan, 1750, undefined, beard, 11, 100),
            seat(niko, 5000),
          ]),
          visit('a3', day(-2), [seat(ivan, 1000, SeatOutcome.noShow(stamp))]),
        ],
      }),
    );
    expect(
      report.reportDayRows.map((row) => [
        row.localDate,
        row.dayTakingsCents,
        row.dayTipsCents,
        row.currency,
      ]),
    ).toEqual([
      [day(-3), 2000, 300, 'EUR'],
      [day(-2), 1750, 100, 'EUR'],
    ]);
    const takings = report.reportDayRows.reduce(
      (sum, row) => sum + row.dayTakingsCents,
      0,
    );
    const tips = report.reportDayRows.reduce(
      (sum, row) => sum + row.dayTipsCents,
      0,
    );
    expect(takings).toBe(report.reportTakingsCents);
    expect(tips).toBe(report.reportTipsCents);
    expect(S.VISITS_PER_BARBER_DAY).toBe(60);
    expect(S.FOLLOW_UPS_PER_VISIT).toBe(5);
  });

  it('states the bookable hours ahead and the emptiest day, the earliest on a tie', () => {
    const ahead = (localDay: LocalDate, open: number): ChairDay =>
      dayOf(ivan, localDay, { openMinutes: open });
    const report = S.report(
      input({
        aheadDays: [ahead(day(1), 90), ahead(day(2), 120), ahead(day(3), 120)],
      }),
    );
    expect(report.reportBookableOpenMinutes).toBe(330);
    expect(report.reportEmptiestLocalDate).toBe(day(2));
    expect(S.report(input()).reportEmptiestLocalDate).toBeNull();
    // The card's bars: today and the six after it, summing to the total.
    expect(report.reportAheadDays.map((row) => row.localDate)).toEqual(
      S.aheadDaysOf(TODAY),
    );
    expect(report.reportAheadDays.map((row) => row.openMinutes)).toEqual([
      0, 90, 120, 120, 0, 0, 0,
    ]);
    expect(
      report.reportAheadDays.reduce((sum, row) => sum + row.openMinutes, 0),
    ).toBe(report.reportBookableOpenMinutes);
    expect(S.report(input()).reportAheadDays).toHaveLength(7);
  });

  it('states the working time ahead the open hours are part of, and whose — breaks, blocks and days off are none of it', () => {
    const report = S.report(
      input({
        scopeBarberIds: [],
        barberIds: [ivan, niko],
        aheadDays: [
          // Tomorrow, Ivan: 2 h booked, 5 h open, 30 min of short gaps
          // ahead (10 already past), a 60 min lunch and a 45 min block
          // that are not working time.
          dayOf(ivan, day(1), {
            bookedAheadMinutes: 120,
            openMinutes: 300,
            shortGapMinutes: 40,
            pastShortGapMinutes: 10,
            breakMinutes: 60,
            blockedMinutes: 45,
          }),
          // Niko works tomorrow too: 8 h, all open.
          dayOf(niko, day(1), { openMinutes: 480 }),
          // Niko's day off: nothing rostered, nothing ahead.
          dayOf(niko, day(2), {}),
        ],
      }),
    );
    expect(report.reportAheadDays.map((row) => row.workingMinutes)).toEqual([
      0,
      120 + 300 + 30 + 480,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(report.reportBookableWorkingMinutes).toBe(930);
    expect(report.reportBookableOpenMinutes).toBe(780);
    // Two barbers have working time ahead; whose hours the card adds up.
    expect(report.reportAheadBarberCount).toBe(2);
    expect(S.report(input()).reportAheadBarberCount).toBe(0);
  });

  describe('the charts (v2)', () => {
    const stretch = (start: number, end: number): MinuteRange =>
      MinuteRange.of(minute(start), endMinute(end));
    const sum = <T>(rows: readonly T[], read: (row: T) => number): number =>
      rows.reduce((total, row) => total + read(row), 0);

    it('charts the takings and the time bars day by day, each series summing to its total', () => {
      const report = S.report(
        input({
          visits: [
            visit('a1', day(-3), [seat(ivan, 2000), seat(niko, 900)]),
            visit('a2', day(-2), [
              seat(ivan, 1500),
              seat(ivan, 1000, SeatOutcome.noShow(stamp)),
            ]),
            visit('a3', TODAY, [seat(ivan, 500, undefined, cut, 13)]),
          ],
          days: [
            dayOf(ivan, day(-3), {
              rosteredMinutes: 600,
              workedMinutes: 300,
              noShowMinutes: 30,
              unmarkedMinutes: 15,
              blockedMinutes: 60,
              pastBlockedMinutes: 60,
              unsoldMinutes: 150,
              heldMinutes: 30,
              pastHeldMinutes: 30,
              shortGapMinutes: 15,
              pastShortGapMinutes: 15,
            }),
            dayOf(ivan, TODAY, {
              rosteredMinutes: 600,
              workedMinutes: 120,
              unsoldMinutes: 60,
              blockedMinutes: 60,
              pastBlockedMinutes: 20,
              openMinutes: 360,
            }),
            // Niko's day is out of scope.
            dayOf(niko, day(-3), { rosteredMinutes: 600, workedMinutes: 600 }),
          ],
        }),
      );
      // October, day by day: 31 points, the visits' days carrying the money.
      expect(report.reportSeries).toHaveLength(31);
      expect(report.reportSeries.map((p) => p.localDate)).toEqual(
        AnalyticsPeriod.days(OCTOBER),
      );
      const point = (localDay: LocalDate) =>
        report.reportSeries.find((p) => p.localDate === localDay);
      expect(point(day(-3))?.takingsCents).toBe(2000);
      expect(point(day(-2))?.takingsCents).toBe(1500);
      expect(point(TODAY)?.takingsCents).toBe(500);
      expect(sum(report.reportSeries, (p) => p.takingsCents)).toBe(
        report.reportTakingsCents,
      );
      // No previous visits: September's 30 points are 0; October's 31st has no counterpart.
      expect(
        report.reportSeries
          .slice(0, 30)
          .every((p) => p.comparisonTakingsCents === 0),
      ).toBe(true);
      expect(report.reportSeries[30]?.comparisonTakingsCents).toBeNull();

      expect(report.reportTimeSeries).toHaveLength(31);
      const bar = (localDay: LocalDate) =>
        report.reportTimeSeries.find((p) => p.localDate === localDay);
      expect(bar(day(-3))).toEqual({
        localDate: day(-3),
        workedMinutes: 300,
        noShowMinutes: 30,
        unmarkedMinutes: 15,
        blockedMinutes: 60,
        unsoldMinutes: 150,
        otherMinutes: 45,
      });
      expect(bar(TODAY)?.blockedMinutes).toBe(20);
      expect(sum(report.reportTimeSeries, (p) => p.workedMinutes)).toBe(
        report.reportBarWorkedMinutes,
      );
      expect(sum(report.reportTimeSeries, (p) => p.noShowMinutes)).toBe(
        report.reportBarNoShowMinutes,
      );
      expect(sum(report.reportTimeSeries, (p) => p.unmarkedMinutes)).toBe(
        report.reportBarUnmarkedMinutes,
      );
      expect(sum(report.reportTimeSeries, (p) => p.blockedMinutes)).toBe(
        report.reportBarBlockedMinutes,
      );
      expect(sum(report.reportTimeSeries, (p) => p.unsoldMinutes)).toBe(
        report.reportBarUnsoldMinutes,
      );
      expect(sum(report.reportTimeSeries, (p) => p.otherMinutes)).toBe(
        report.reportBarOtherMinutes,
      );
    });

    it('switches to ISO weeks past 93 days: the first day, then every Monday', () => {
      const quarter = {
        analyticsSpan: AnalyticsSpan.Month,
        fromLocalDate: localDate('2026-01-01'),
        toLocalDate: localDate('2026-04-03'),
      };
      expect(AnalyticsPeriod.length(quarter)).toBe(93);
      expect(S.seriesStartsOf(quarter)).toEqual(AnalyticsPeriod.days(quarter));
      const longer = { ...quarter, toLocalDate: localDate('2026-04-04') };
      const starts = S.seriesStartsOf(longer);
      // Thursday 1 January, then the Mondays 5 January … 30 March.
      expect(starts[0]).toBe('2026-01-01');
      expect(starts[1]).toBe('2026-01-05');
      expect(starts[starts.length - 1]).toBe('2026-03-30');
      expect(starts).toHaveLength(14);
      expect(starts.slice(1).every((d) => LocalDate.weekday(d) === 1)).toBe(
        true,
      );

      const report = S.report(
        input({
          period: longer,
          visits: [
            visit('w0', localDate('2026-01-03'), [
              seat(ivan, 1000, undefined, cut, 10, 150),
            ]),
            visit('w1', localDate('2026-01-05'), [seat(ivan, 2000)]),
            visit('w1b', localDate('2026-01-11'), [
              seat(ivan, 500, undefined, cut, 10, 50),
            ]),
            visit('wl', localDate('2026-04-04'), [
              seat(ivan, 300, undefined, cut, 10, 20),
            ]),
          ],
          days: [
            dayOf(ivan, localDate('2026-01-03'), { workedMinutes: 30 }),
            dayOf(ivan, localDate('2026-04-04'), { workedMinutes: 60 }),
          ],
        }),
      );
      expect(report.reportSeries.map((p) => p.takingsCents)).toEqual([
        1000, 2500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 300,
      ]);
      expect(report.reportTimeSeries.map((p) => p.workedMinutes)).toEqual([
        30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60,
      ]);
      expect(sum(report.reportSeries, (p) => p.takingsCents)).toBe(
        report.reportTakingsCents,
      );
      // The tips share the takings' buckets — a range this long keeps its
      // day rows per month, but its series never needs them (owner,
      // 2026-11-09: tips over 6М / 1Г / МАКС had no line or bars).
      expect(report.reportSeries.map((p) => p.tipsCents)).toEqual([
        150, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20,
      ]);
      expect(sum(report.reportSeries, (p) => p.tipsCents)).toBe(
        report.reportTipsCents,
      );
      // Each point's takings by service make its takings, service by
      // service — the stacked bars' parts.
      for (const point of report.reportSeries) {
        expect(sum(point.serviceTakings, (row) => row.takingsCents)).toBe(
          point.takingsCents,
        );
      }
      expect(
        report.reportSeries[0]?.serviceTakings.map((row) => row.serviceId),
      ).toEqual([cut]);
    });

    it('aligns the comparison by position, null where the shorter previous period ends', () => {
      // March 2026 against February: 31 points, 28 with a counterpart.
      const march = AnalyticsPeriod.monthOf(localDate('2026-03-01'));
      const report = S.report(
        input({
          period: march,
          visits: [visit('m', localDate('2026-03-03'), [seat(ivan, 4000)])],
          previousVisits: [
            visit('f', localDate('2026-02-03'), [seat(ivan, 2500)]),
            // A no-show adds nothing to the line.
            visit('n', localDate('2026-02-04'), [
              seat(ivan, 2500, SeatOutcome.noShow(stamp)),
            ]),
          ],
        }),
      );
      expect(report.reportSeries).toHaveLength(31);
      expect(report.reportSeries[2]).toMatchObject({
        localDate: localDate('2026-03-03'),
        takingsCents: 4000,
        tipsCents: 0,
        comparisonTakingsCents: 2500,
      });
      expect(report.reportSeries[3]?.comparisonTakingsCents).toBe(0);
      expect(
        report.reportSeries
          .slice(0, 28)
          .every((p) => p.comparisonTakingsCents !== null),
      ).toBe(true);
      expect(
        report.reportSeries
          .slice(28)
          .every((p) => p.comparisonTakingsCents === null),
      ).toBe(true);
    });

    it('builds the hour grid from each day’s stretches and worked seats, and names the peaks from 7 rostered days', () => {
      // Monday 5 … Sunday 11 October, each rostered 09:00–12:00.
      const week = LocalDate.range(day(-9), day(-3));
      const morning = [stretch(540, 720)];
      const days = week.map((d, i) =>
        dayOf(
          ivan,
          d,
          {
            rosteredMinutes: 180,
            workedMinutes: i === 0 ? 30 : i === 1 ? 60 : 0,
          },
          morning,
        ),
      );
      const visits = [
        // Monday 10:00–10:30.
        visit('mon', day(-9), [seat(ivan, 1000)]),
        // Tuesday 10:00–10:30 and 10:30–11:00: the hour is full.
        visit('tue1', day(-8), [seat(ivan, 1000)]),
        visit('tue2', day(-8), [
          seatFixture({
            seatId: SeatId.of('s-tue2'),
            barberId: ivan,
            serviceId: cut,
            startMinutes: minute(630),
            terms: Seat.termsOf(termsFixture(1000, 30, 0, 0), null),
            outcome: SeatOutcome.worked(stamp),
          }),
        ]),
        // A no-show on Wednesday: not busy.
        visit('wed', day(-7), [seat(ivan, 1000, SeatOutcome.noShow(stamp))]),
        // Niko's worked seat on Monday: out of scope.
        visit('niko', day(-9), [seat(niko, 1000)]),
      ];
      const report = S.report(input({ days, visits }));
      expect(report.reportHourGrid).toHaveLength(21);
      const cell = (weekday: Weekday, hour: number) =>
        report.reportHourGrid.find(
          (c) => c.weekday === weekday && c.hour === hour,
        );
      expect(cell(Weekday.Mon, 10)).toEqual({
        weekday: Weekday.Mon,
        hour: 10,
        workedMinutes: 30,
        rosteredMinutes: 60,
      });
      expect(cell(Weekday.Tue, 10)?.workedMinutes).toBe(60);
      expect(cell(Weekday.Wed, 10)?.workedMinutes).toBe(0);
      expect(cell(Weekday.Mon, 12)).toBeUndefined();
      expect(sum(report.reportHourGrid, (c) => c.workedMinutes)).toBe(
        report.reportWorkedMinutes,
      );
      expect(sum(report.reportHourGrid, (c) => c.rosteredMinutes)).toBe(
        report.reportRosteredMinutes,
      );
      expect(report.reportBusiestWeekday).toBe(Weekday.Tue);
      expect(report.reportBusiestHour).toBe(10);
      // Every other cell is empty: the earliest of them.
      expect(report.reportEmptiestWeekday).toBe(Weekday.Mon);
      expect(report.reportEmptiestHour).toBe(9);

      // Six rostered days: a grid, but no peaks named.
      const six = S.report(input({ days: days.slice(1), visits }));
      expect(six.reportHourGrid.length).toBeGreaterThan(0);
      expect(six.reportBusiestWeekday).toBeNull();
      expect(six.reportBusiestHour).toBeNull();
      expect(six.reportEmptiestWeekday).toBeNull();
      expect(six.reportEmptiestHour).toBeNull();
    });

    it('a shop report sums its barbers’ days into the same cells', () => {
      const monday = day(-9);
      const report = S.report(
        input({
          scopeBarberIds: [],
          barberIds: [ivan, niko],
          days: [
            dayOf(ivan, monday, { rosteredMinutes: 60 }, [stretch(600, 660)]),
            dayOf(niko, monday, { rosteredMinutes: 60 }, [stretch(600, 660)]),
          ],
          visits: [visit('m', monday, [seat(ivan, 1000), seat(niko, 1000)])],
        }),
      );
      expect(report.reportHourGrid).toEqual([
        {
          weekday: Weekday.Mon,
          hour: 10,
          workedMinutes: 60,
          rosteredMinutes: 120,
        },
      ]);
    });
  });

  it('gives a shop report a per-barber list and no seat rows', () => {
    const report = S.report(
      input({
        scopeBarberIds: [],
        barberIds: [ivan, niko],
        visits: [visit('a1', day(-2), [seat(ivan, 2000), seat(niko, 1500)])],
      }),
    );
    expect(report.reportSeatRows).toEqual([]);
    expect(
      report.reportBarbers.map((b) => [b.barberId, b.takingsCents]),
    ).toEqual([
      [ivan, 2000],
      [niko, 1500],
    ]);
    expect(report.reportTakingsCents).toBe(3500);
  });

  describe('the admin’s radar (v2 PR 5)', () => {
    const cents = (raw: number): PriceCents => raw as PriceCents;
    const m = (raw: number): MinuteCount => raw as MinuteCount;
    /** A stored day of `barberId` clearing the floors on its own: 20 seats over 200 service minutes, 20 in each base. */
    const strongDay = (
      barberId: BarberId,
      localDay: LocalDate,
      takings: number,
      rebooked: number,
      noShows: number,
    ): DayFigures => ({
      ...DayFigures.empty(barberId, localDay, stamp),
      dayRosteredMinutes: m(480),
      dayWorkedMinutes: m(200),
      dayUnsoldMinutes: m(280),
      dayTakingsCents: cents(takings),
      dayTipsCents: cents(100),
      dayWorkedSeatCount: 20,
      dayNoShowBase: 20 + noShows,
      dayNoShowCount: noShows,
      dayRebookedBase: 20,
      dayRebookedCount: rebooked,
      dayServices: [
        {
          serviceId: cut,
          workedSeatCount: 20,
          takingsCents: cents(takings),
          serviceMinutes: m(200),
        },
      ],
    });
    /** Seven rostered days each (the fill floor), one of them strong, the rest empty rosters. */
    const sevenDays = (
      barberId: BarberId,
      strong: DayFigures,
    ): DayFigures[] => [
      strong,
      ...[-9, -8, -7, -6, -5, -4].map((n) => ({
        ...DayFigures.empty(barberId, day(n), stamp),
        dayRosteredMinutes: m(480),
        dayUnsoldMinutes: m(480),
      })),
    ];
    const shop = (overrides: Partial<AnalyticsInput> = {}) =>
      input({
        scopeBarberIds: [],
        barberIds: [ivan, niko],
        pastDays: [
          ...sevenDays(ivan, strongDay(ivan, day(-10), 6000, 10, 0)),
          ...sevenDays(niko, strongDay(niko, day(-10), 3000, 5, 4)),
        ],
        // The live day adds a seat and 30 service minutes to each.
        visits: [visit('live', day(-2), [seat(ivan, 1200), seat(niko, 600)])],
        days: [
          dayOf(ivan, day(-2), { rosteredMinutes: 480, workedMinutes: 30 }),
          dayOf(niko, day(-2), { rosteredMinutes: 480, workedMinutes: 30 }),
        ],
        ...overrides,
      });

    it('fills each barber’s service minutes, worked seats and rostered days from the stored days and the live seats', () => {
      const report = S.report(shop());
      expect(report.reportBarbers.map((b) => b.barberId)).toEqual([ivan, niko]);
      expect(report.reportBarbers[0]).toMatchObject({
        serviceMinutes: 230,
        workedSeatCount: 21,
        rosteredDayCount: 8,
        takingsCents: 7200,
        workedMinutes: 230,
        rosteredMinutes: 480 * 8,
      });
      // The barbers' bases sum to the shop's service rows.
      expect(
        report.reportBarbers.reduce((sum, b) => sum + b.workedSeatCount, 0),
      ).toBe(
        report.reportServices.reduce(
          (sum, row) => sum + row.workedSeatCount,
          0,
        ),
      );
      expect(
        report.reportBarbers.reduce((sum, b) => sum + b.serviceMinutes, 0),
      ).toBe(
        report.reportServices.reduce((sum, row) => sum + row.serviceMinutes, 0),
      );
    });

    it('draws the shop’s radars on a MONTH: one row per barber, normalised against the best', () => {
      const firstSeen = (id: string, on: LocalDate, barber: BarberId) => ({
        customerId: CustomerId.of(id),
        firstVisitLocalDate: on,
        firstVisitBarberIds: [barber],
        firstVisitLocationId: null,
      });
      const report = S.report(
        shop({
          // Two new clients for Ivan, four for Niko; September's are not this month's.
          firstSeen: [
            firstSeen('c-1', day(-10), ivan),
            firstSeen('c-2', day(-2), ivan),
            firstSeen('c-3', day(-10), niko),
            firstSeen('c-4', day(-10), niko),
            firstSeen('c-5', day(-2), niko),
            firstSeen('c-6', day(-2), niko),
            firstSeen('c-7', localDate('2026-09-20'), ivan),
          ],
        }),
      );
      expect(report.reportBarbers.map((b) => b.newClientCount)).toEqual([2, 4]);
      expect(report.reportRadarBase).toBe(RadarBase.BestOfShop);
      expect(report.reportRadars.map((row) => row.barberId)).toEqual([
        ivan,
        niko,
      ]);
      // Ivan: 7200 ÷ 230 an hour — the best; 230 ÷ 3840 fill — the same as Niko's; 10 ÷ 20 rebooked — the best; 100 ÷ 7200 tips — half Niko's rate.
      expect(report.reportRadars[0]).toMatchObject({
        takingsPerHour: 100,
        fill: 100,
        rebooking: 100,
        tipsRate: 50,
      });
      expect(report.reportRadars[1]).toMatchObject({
        takingsPerHour: 50,
        fill: 100,
        rebooking: 50,
        tipsRate: 100,
      });
      // New clients: Ivan's 2 against Niko's 4.
      expect(report.reportRadars[0]?.newClients).toBe(50);
      expect(report.reportRadars[1]?.newClients).toBe(100);
      // The maximum itself never leaves the server: no field of the report carries 7200 ÷ 230 × 60.
      expect(JSON.stringify(report)).not.toContain(String((7200 / 230) * 60));
      expect(report.reportRadars).toEqual(
        AnalyticsRadarSystem.radarsOf(report.reportBarbers, []).reportRadars,
      );
    });

    it('builds the comparison period’s barbers from its stored days and live visits, and draws them on this period’s best', () => {
      const report = S.report(
        shop({
          previousPastDays: sevenDays(
            ivan,
            strongDay(ivan, localDate('2026-09-10'), 3000, 8, 2),
          ),
          // One new client of Ivan's this month, two in September — the comparison's.
          firstSeen: [
            {
              customerId: CustomerId.of('c-oct'),
              firstVisitLocalDate: day(-2),
              firstVisitBarberIds: [ivan],
              firstVisitLocationId: null,
            },
            {
              customerId: CustomerId.of('c-sep-1'),
              firstVisitLocalDate: localDate('2026-09-10'),
              firstVisitBarberIds: [ivan],
              firstVisitLocationId: null,
            },
            {
              customerId: CustomerId.of('c-sep-2'),
              firstVisitLocalDate: localDate('2026-09-20'),
              firstVisitBarberIds: [ivan],
              firstVisitLocationId: null,
            },
          ],
          // A live comparison visit: money and seats count, its day adds no minutes and enters no rebooking base.
          previousVisits: [
            visit('sept', localDate('2026-09-20'), [seat(ivan, 600)]),
          ],
        }),
      );
      expect(report.reportComparisonBarbers.map((b) => b.barberId)).toEqual([
        ivan,
        niko,
      ]);
      expect(report.reportComparisonBarbers[0]).toMatchObject({
        takingsCents: 3600,
        serviceMinutes: 230,
        workedSeatCount: 21,
        rosteredDayCount: 7,
        rosteredMinutes: 480 * 7,
        workedMinutes: 200,
        rebookedBase: 20,
        rebookedCount: 8,
        rebookedRate: 0.4,
        // The live seat joins the no-show base: 2 of 23.
        noShowRate: 2 / 23,
        newClientCount: 2,
      });
      expect(report.reportComparisonBarbers[1]).toMatchObject({
        takingsCents: 0,
        workedSeatCount: 0,
        rosteredDayCount: 0,
      });
      // Ivan last month against this month's best: 3600 ÷ 230 an hour of
      // 7200 ÷ 230 → 50; 200 ÷ 3360 of 230 ÷ 3840 → ≈ 99.4; 8 ÷ 20 rebooked
      // of this month's 10 ÷ 21 (the live past day joined the base) → 84.
      const ivanRow = report.reportRadars[0] as AnalyticsReport.RadarRow;
      expect(ivanRow).toMatchObject({ comparisonTakingsPerHour: 50 });
      expect(ivanRow.comparisonRebooking).toBeCloseTo(84, 10);
      expect(ivanRow.comparisonFill).toBeCloseTo(
        (200 / 3360 / (230 / 3840)) * 100,
        10,
      );
      // Two new clients in September against this month's best of one.
      expect(ivanRow.comparisonNewClients).toBe(200);
      // Niko has no comparison figures over any floor: every comparison axis missing.
      expect(report.reportRadars[1]).toMatchObject({
        comparisonTakingsPerHour: null,
        comparisonFill: null,
        comparisonRebooking: null,
        comparisonTipsRate: null,
        comparisonNewClients: null,
      });
    });

    it('carries no comparison barbers when the period is not comparable', () => {
      const report = S.report(
        shop({
          period: AnalyticsPeriod.yearOf(TODAY),
          previousPastDays: [strongDay(ivan, localDate('2025-09-10'), 1, 1, 1)],
        }),
      );
      expect(report.reportComparisonFromLocalDate).toBeNull();
      expect(report.reportComparisonBarbers).toEqual([]);
      expect(report.reportRadars[0]?.comparisonTakingsPerHour).toBeNull();
    });

    it('carries radars on a YEAR and a CUSTOM range, none on a DAY or a WEEK', () => {
      expect(
        S.report(shop({ period: AnalyticsPeriod.yearOf(TODAY) })).reportRadars,
      ).toHaveLength(2);
      expect(
        S.report(
          shop({
            period: AnalyticsPeriod.customOf(day(-12), TODAY),
          }),
        ).reportRadars,
      ).toHaveLength(2);
      for (const period of [
        AnalyticsPeriod.dayOf(day(-2)),
        AnalyticsPeriod.weekOf(day(-2)),
      ]) {
        const report = S.report(shop({ period }));
        expect(report.reportRadars).toEqual([]);
        expect(report.reportRadarBase).toBe(RadarBase.TooFewBarbers);
        // The barbers themselves stay, as on every span.
        expect(report.reportBarbers).toHaveLength(2);
      }
    });

    it('a barber’s report carries no radar, no barbers and no comparison barbers', () => {
      const report = S.report(
        shop({ scopeBarberIds: [ivan], barberIds: [ivan] }),
      );
      expect(report.reportBarbers).toEqual([]);
      expect(report.reportComparisonBarbers).toEqual([]);
      expect(report.reportRadars).toEqual([]);
      expect(report.reportRadarBase).toBe(RadarBase.TooFewBarbers);
    });

    it('a shop of one barber: the barber listed, no radar, TOO_FEW_BARBERS', () => {
      const report = S.report(shop({ barberIds: [ivan] }));
      expect(report.reportBarbers).toHaveLength(1);
      expect(report.reportRadars).toEqual([]);
      expect(report.reportRadarBase).toBe(RadarBase.TooFewBarbers);
    });
  });

  it('lists the seat rows that add up to every money and count figure', () => {
    const report = S.report(
      input({
        visits: [
          visit('r1', day(-3), [
            seat(ivan, 2000, undefined, cut, 10, 200),
            seat(ivan, 1000, undefined, beard, 11),
          ]),
          visit('r2', day(-2), [seat(ivan, 1500, SeatOutcome.noShow(stamp))]),
          visit('r3', day(-1), [seat(niko, 9000)]),
        ],
      }),
    );
    const all = { serviceId: null, localDate: null };
    const takings = S.seatRowsFor(report, AnalyticsFigure.Takings, all);
    expect(takings.reduce((t, r) => t + r.netCents, 0)).toBe(
      report.reportTakingsCents,
    );
    const tips = S.seatRowsFor(report, AnalyticsFigure.Tips, all);
    expect(tips.reduce((t, r) => t + r.tipCents, 0)).toBe(
      report.reportTipsCents,
    );
    expect(S.seatRowsFor(report, AnalyticsFigure.NoShows, all)).toHaveLength(
      report.reportNoShowCount,
    );
    expect(
      S.seatRowsFor(report, AnalyticsFigure.Takings, {
        serviceId: beard,
        localDate: null,
      }),
    ).toHaveLength(1);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(
      input({
        visits: [visit('a1', day(-2), [seat(ivan, 2000)])],
        days: [
          dayOf(ivan, day(-2), { rosteredMinutes: 600, workedMinutes: 30 }),
        ],
      }),
    );
    expect(S.report(frozen)).toEqual(S.report(frozen));
  });
});

describe('StaffAnalyticsSystem — what the pipeline reads and builds', () => {
  const centre = LocationId.of('loc-center');
  const mladost = LocationId.of('loc-mladost');

  it('reads the caller off the stored record: roles, a block at the instant, the link', () => {
    const linked = registeredUserFixture({
      id: UserId.of('u-ivan'),
      roles: [Role.Barber],
      linkedBarberId: ivan,
    });
    expect(S.callerOf(linked, stamp)).toEqual({
      ok: true,
      value: {
        callerRoles: [Role.Barber],
        callerBlocked: false,
        linkedBarberId: ivan,
      },
    });
    const blocked = blockedUserFixture({ roles: [Role.Admin] });
    expect(S.callerOf(blocked, stamp)).toMatchObject({
      ok: true,
      value: { callerBlocked: true, linkedBarberId: null },
    });
    // The block ran out: no longer blocked at a later instant.
    const later = UtcEpochMs.plusDays(stamp, 400);
    expect(S.callerOf(blocked, later)).toMatchObject({
      value: { callerBlocked: false },
    });
    expect(S.callerOf(null, stamp)).toEqual({
      ok: false,
      error: { errorCode: 'ANALYTICS_FORBIDDEN' },
    });
  });

  it('takes today from the default shop, else the first by id, else none', () => {
    const a = locationFixture({ id: mladost });
    const b = locationFixture({
      id: centre,
      locationStatus: LocationStatus.Hidden,
    });
    expect(S.clockLocationOf([a, b], centre)).toBe(b);
    expect(S.clockLocationOf([a, b], LocationId.of('loc-x'))).toBe(b);
    expect(S.clockLocationOf([], centre)).toBeNull();
  });

  it('scopeToggled: «all» and the boxes are either/or — from the whole list a box names it alone; the last off or every one on is the whole list', () => {
    const tom = BarberId.of('tom');
    const all = [ivan, niko, tom];
    // From the whole list: the box tapped, alone.
    expect(S.scopeToggled([], niko, all)).toEqual([niko]);
    // A box on, a box off.
    expect(S.scopeToggled([niko], ivan, all)).toEqual([ivan, niko]);
    expect(S.scopeToggled([ivan, niko], ivan, all)).toEqual([niko]);
    // The last box off is the whole list again.
    expect(S.scopeToggled([ivan], ivan, all)).toEqual([]);
    // Every box ticked is the whole list again.
    expect(S.scopeToggled([ivan, niko], tom, all)).toEqual([]);
    // A list of one has nothing to narrow.
    expect(S.scopeToggled([], ivan, [ivan])).toEqual([]);
    const frozen = deepFreeze([ivan]);
    expect(S.scopeToggled(frozen, niko, all)).toEqual(
      S.scopeToggled(frozen, niko, all),
    );
  });

  it('scopes the shop to every record by id, named barbers to them, and knows a barber’s own report', () => {
    expect(S.barbersInScope([], [niko, ivan])).toEqual([ivan, niko]);
    expect(S.barbersInScope([niko], [niko, ivan])).toEqual([niko]);
    expect(S.barbersInScope([ivan, niko], [niko, ivan])).toEqual([ivan, niko]);
    expect(S.soleBarberOf([])).toBeNull();
    expect(S.soleBarberOf([niko])).toBe(niko);
    expect(S.soleBarberOf([ivan, niko])).toBeNull();
  });

  it('reads the next 7 shop days from today, and every barber-day’s key', () => {
    expect(S.aheadDaysOf(TODAY)).toEqual(
      LocalDate.range(TODAY, LocalDate.addDays(TODAY, 6)),
    );
    expect(S.busyKeysOf([ivan, niko], [day(0), day(1)])).toEqual([
      BusyKey.of(ivan, day(0)),
      BusyKey.of(ivan, day(1)),
      BusyKey.of(niko, day(0)),
      BusyKey.of(niko, day(1)),
    ]);
  });

  it('counts each appointment once, in first-read order', () => {
    const a = visit('a', day(-3), [seat(ivan, 1000)]);
    const b = visit('b', day(-3), [seat(ivan, 1000), seat(niko, 1000)]);
    expect(S.mergeVisits([a, b, b, a])).toEqual([a, b]);
  });

  it('reads follow-ups only for the visits in the rebooking base', () => {
    const ended = visit('ended', day(-2), [seat(ivan, 1000)]);
    const open = visit('open', day(-1), [seat(ivan, 1000)]);
    const others = visit('others', day(-5), [seat(niko, 1000)]);
    const noShow = visit('no-show', day(-5), [
      seat(ivan, 1000, SeatOutcome.noShow(stamp)),
    ]);
    expect(
      S.followUpSourcesOf([ended, open, others, noShow], ivan, TODAY),
    ).toEqual([ended.id]);
  });

  it('keeps a follow-up booked from a visit at a known instant, cancelled or not', () => {
    const from = AppointmentId.of('a-from');
    const booked = visit('f', day(3), [seat(ivan, 1000)], {
      bookedFromAppointmentId: from,
    } as Partial<AnalyticsVisit>) as unknown as Parameters<
      typeof S.isCountedFollowUp
    >[0];
    expect(S.isCountedFollowUp(booked)).toBe(true);
    expect(S.isCountedFollowUp({ ...booked, bookedAtUtcMs: null })).toBe(false);
    expect(
      S.isCountedFollowUp({ ...booked, bookedFromAppointmentId: null }),
    ).toBe(false);
    if (!S.isCountedFollowUp(booked)) throw new Error('unreachable');
    expect(S.followUpOf(booked, day(-1))).toEqual({
      bookedFromAppointmentId: from,
      bookedOnLocalDate: day(-1),
      followUpCancelled: false,
    });
    const cancelled = {
      ...booked,
      ...BookingLifecycle.sliceOf(
        BookingLifecycle.cancel(
          stamp,
          CancellationReasonSet.of([CancellationReason.Other]),
        ),
      ),
    } as typeof booked;
    expect(S.followUpOf(cancelled, day(-1)).followUpCancelled).toBe(true);
  });

  describe('daysOf — the scope’s barber-days', () => {
    // Monday 12 October: Ivan rostered 09:00–18:00 at the centre.
    const monday = day(-2);
    // The centre's clock: Wednesday the 14th, 14:00 — the 12th is past.
    const centreNow: ShopNow = NOW;
    const days = (overrides: Partial<AnalyticsDaysInput> = {}) =>
      S.daysOf({
        barberIds: [ivan],
        localDates: [monday],
        rosters: [barberScheduleFixture({ id: ivan })],
        departures: [],
        locations: [locationFixture()],
        visits: [],
        nowByLocation: [{ locationId: centre, ...centreNow }],
        now: NOW,
        ...overrides,
      });

    it('rosters the day as the schedule offers it, with its visits', () => {
      const [only] = days({
        visits: [visit('a', monday, [seat(ivan, 1000)])],
      });
      expect(only).toMatchObject({
        barberId: ivan,
        localDate: monday,
        rosteredMinutes: 9 * 60,
        workedMinutes: 30,
        closedDayMinutes: 0,
      });
      // The offered stretches: the rostered ranges the hour grid buckets.
      expect(only?.stretches).toMatchObject([
        { startMinutes: 9 * 60, endMinutes: 18 * 60 },
      ]);
    });

    it('offers no stretch at a shop that is not ACTIVE, nor on a CLOSED day', () => {
      const [hidden] = days({
        locations: [locationFixture({ locationStatus: LocationStatus.Hidden })],
      });
      expect(hidden?.stretches).toEqual([]);
      const [closed] = days({
        departures: [
          scheduleExceptionFixture({
            id: ScheduleExceptionId.of(BusyKey.of(ivan, monday)),
            barberId: ivan,
            localDate: monday,
          }),
        ],
      });
      expect(closed?.stretches).toEqual([]);
    });

    it('offers nothing at a shop that is not ACTIVE', () => {
      const [only] = days({
        locations: [locationFixture({ locationStatus: LocationStatus.Hidden })],
      });
      expect(only?.rosteredMinutes).toBe(0);
    });

    it('keeps a CLOSED day’s would-be minutes beside its zero', () => {
      const [only] = days({
        departures: [
          scheduleExceptionFixture({
            id: ScheduleExceptionId.of(BusyKey.of(ivan, monday)),
            barberId: ivan,
            localDate: monday,
          }),
        ],
      });
      expect(only?.rosteredMinutes).toBe(0);
      expect(only?.closedDayMinutes).toBe(9 * 60);
    });

    it('reads a day on its shop’s clock, and a day at no known shop on the report’s', () => {
      // On the centre's clock the 12th is past: no open time.
      const [past] = days();
      expect(past?.openMinutes).toBe(0);
      // A report clock that says the 12th is still ahead does not apply to a
      // day worked at the centre…
      const early: ShopNow = { ...NOW, localDate: day(-5) };
      const [onCentre] = days({ now: early });
      expect(onCentre?.openMinutes).toBe(0);
      // …but does to a day whose shop has no clock of its own.
      const [onFallback] = days({ now: early, nowByLocation: [] });
      expect(onFallback?.openMinutes).toBe(9 * 60);
    });

    it('marks a day PAST two days back on every stretch shop’s clock — two locations, and a stretch-less day on the report’s (v2, Terms)', () => {
      const mladost = LocationId.of('loc-mladost');
      // The centre says the 14th; Mladost's clock is a day behind.
      const clocks = [
        { locationId: centre, ...NOW },
        { locationId: mladost, ...NOW, localDate: day(-1) },
      ];
      const at = (locationId: LocationId) => [{ locationId }];
      // The 12th: past at the centre (13 < 14), not at Mladost (13 < 13 fails).
      expect(S.isPastDay(day(-2), clocks, at(centre), NOW)).toBe(true);
      expect(S.isPastDay(day(-2), clocks, at(mladost), NOW)).toBe(false);
      expect(
        S.isPastDay(day(-2), clocks, [...at(centre), ...at(mladost)], NOW),
      ).toBe(false);
      // The 11th is past everywhere; yesterday nowhere.
      expect(
        S.isPastDay(day(-3), clocks, [...at(centre), ...at(mladost)], NOW),
      ).toBe(true);
      expect(S.isPastDay(day(-1), clocks, at(centre), NOW)).toBe(false);
      // No stretch at any shop: the default clock judges.
      expect(S.isPastDay(day(-2), clocks, [], NOW)).toBe(true);
      expect(
        S.isPastDay(day(-2), clocks, [], { ...NOW, localDate: day(-1) }),
      ).toBe(false);
      // A shop whose clock was not read reads as the default clock.
      expect(S.isPastDay(day(-2), [], at(mladost), NOW)).toBe(true);
      // Through daysOf: the day carries the verdict.
      expect(days()[0]?.pastDay).toBe(true);
      expect(days({ localDates: [day(-1)] })[0]?.pastDay).toBe(false);
      expect(
        days({ nowByLocation: clocks, localDates: [monday] })[0]?.pastDay,
      ).toBe(true);
    });

    it('builds every barber × day, barber by barber', () => {
      const built = days({
        barberIds: [ivan, niko],
        localDates: [monday, day(-1)],
        rosters: [barberScheduleFixture({ id: ivan })],
      });
      expect(built.map((d) => [d.barberId, d.localDate])).toEqual([
        [ivan, monday],
        [ivan, day(-1)],
        [niko, monday],
        [niko, day(-1)],
      ]);
      // Niko has no roster: nothing rostered.
      expect(built[2]?.rosteredMinutes).toBe(0);
    });

    it('is pure: same input → same output, inputs untouched', () => {
      const frozen = deepFreeze({
        barberIds: [ivan],
        localDates: [monday],
        rosters: [barberScheduleFixture({ id: ivan })],
        departures: [],
        locations: [locationFixture()],
        visits: [visit('a', monday, [seat(ivan, 1000)])],
        nowByLocation: [{ locationId: centre, ...centreNow }],
        now: NOW,
      });
      expect(S.daysOf(frozen)).toEqual(S.daysOf(frozen));
    });
  });
});

describe('StaffAnalyticsSystem — what the screen shows (Law 10: decided here, worded by the presenter)', () => {
  const report = deepFreeze(analyticsReportFixture());

  it('heroChangeOf — none without a previous period, else the direction and the rate', () => {
    expect(
      S.heroChangeOf(analyticsReportFixture({ reportHeroPreviousCents: null })),
    ).toEqual({ heroChange: HeroChange.None, heroChangeRate: null });
    expect(S.heroChangeOf(report)).toEqual({
      heroChange: HeroChange.Up,
      heroChangeRate: (4550 - 3500) / 3500,
    });
    expect(
      S.heroChangeOf(
        analyticsReportFixture({
          reportHeroCurrentCents: 1000 as never,
          reportHeroPreviousCents: 2000 as never,
        }),
      ),
    ).toEqual({ heroChange: HeroChange.Down, heroChangeRate: -0.5 });
    expect(
      S.heroChangeOf(
        analyticsReportFixture({
          reportHeroCurrentCents: 2000 as never,
          reportHeroPreviousCents: 2000 as never,
        }),
      ).heroChange,
    ).toBe(HeroChange.Flat);
    // Up from nothing: a direction, no rate to divide by.
    expect(
      S.heroChangeOf(
        analyticsReportFixture({ reportHeroPreviousCents: 0 as never }),
      ),
    ).toEqual({ heroChange: HeroChange.Up, heroChangeRate: null });
  });

  it('barSegmentsOf — the six parts in order, their shares summing to the whole', () => {
    const segments = S.barSegmentsOf(report);
    expect(segments.map((s) => s.analyticsBarPart)).toEqual([
      AnalyticsBarPart.Worked,
      AnalyticsBarPart.NoShow,
      AnalyticsBarPart.Unmarked,
      AnalyticsBarPart.Blocked,
      AnalyticsBarPart.Unsold,
      AnalyticsBarPart.Other,
    ]);
    expect(segments.map((s) => s.minutes)).toEqual([480, 60, 0, 120, 200, 20]);
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(segments[0]?.share).toBeCloseTo(480 / 880);
    const empty = S.barSegmentsOf(
      analyticsReportFixture({
        reportBarWorkedMinutes: MinuteCount.ZERO,
        reportBarNoShowMinutes: MinuteCount.ZERO,
        reportBarBlockedMinutes: MinuteCount.ZERO,
        reportBarUnsoldMinutes: MinuteCount.ZERO,
        reportBarOtherMinutes: MinuteCount.ZERO,
      }),
    );
    expect(empty.every((s) => s.share === 0)).toBe(true);
  });

  it('serviceSharesOf / originSharesOf — each row’s share of the whole, 0 with nothing', () => {
    expect(S.serviceSharesOf(report)).toEqual([2800 / 4550, 1750 / 4550]);
    expect(S.originSharesOf(report)).toEqual([0.5, 0.5, 0]);
    expect(
      S.serviceSharesOf(
        analyticsReportFixture({
          reportServices: report.reportServices.map((row) => ({
            ...row,
            takingsCents: 0 as never,
          })),
        }),
      ),
    ).toEqual([0, 0]);
  });

  it('screenOf — scope, empty period, small sample, the emptiest day, left-out visits', () => {
    expect(S.screenOf(report)).toEqual({
      shopScope: false,
      drillsToSeats: true,
      periodEmpty: false,
      rostered: true,
      smallSample: true,
      opensEmptiestDay: true,
      excludesVisits: false,
    });
    const shop = S.screenOf(
      analyticsReportFixture({ reportScopeBarberId: null }),
    );
    expect(shop.shopScope).toBe(true);
    expect(shop.drillsToSeats).toBe(false);
    const empty = S.screenOf(
      analyticsReportFixture({
        reportWorkedMinutes: MinuteCount.ZERO,
        reportNoShowMinutes: MinuteCount.ZERO,
        reportBookedAheadMinutes: MinuteCount.ZERO,
        reportTakingsCents: 0 as never,
        reportNoShowCount: 0,
        reportLateCancellationCount: 0,
        reportRebookedBase: 0,
        reportNoShowBase: 0,
        reportEmptiestLocalDate: null,
        reportExcludedVisitCount: 2,
      }),
    );
    expect(empty).toMatchObject({
      periodEmpty: true,
      smallSample: false,
      opensEmptiestDay: false,
      excludesVisits: true,
    });
    // From the base of 20 up the rates show.
    expect(
      S.screenOf(
        analyticsReportFixture({
          reportRebookedRate: 0.5,
          reportRebookedBase: 20,
          reportNoShowRate: 0.05,
          reportNoShowBase: 20,
        }),
      ).smallSample,
    ).toBe(false);
  });

  it('computedOn — the shop day the report was computed on', () => {
    expect(
      S.computedOn(report, FIXTURE_TIME_ZONE, localDate('2026-09-28')),
    ).toBe(true);
    expect(
      S.computedOn(report, FIXTURE_TIME_ZONE, localDate('2026-09-29')),
    ).toBe(false);
  });

  it('stepsOf — back up to 12 months, never past today', () => {
    const today = localDate('2026-10-14');
    const october = AnalyticsPeriod.monthOf(today);
    expect(S.stepsOf(october, today)).toEqual({
      previous: AnalyticsPeriod.monthOf(localDate('2026-09-01')),
      next: null,
    });
    const september = AnalyticsPeriod.monthOf(localDate('2026-09-01'));
    expect(S.stepsOf(september, today).next).toEqual(october);
    const earliest = AnalyticsPeriod.monthOf(localDate('2025-10-01'));
    expect(S.stepsOf(earliest, today).previous).toBeNull();
    const week = AnalyticsPeriod.weekOf(today);
    expect(S.stepsOf(week, today)).toEqual({
      previous: AnalyticsPeriod.weekOf(localDate('2026-10-05')),
      next: null,
    });
    expect(
      S.stepsOf(AnalyticsPeriod.weekOf(localDate('2026-10-05')), today).next,
    ).toEqual(week);
  });

  it('periodInSpan — a switch lands on the period holding the last day, or today', () => {
    const today = localDate('2026-10-14');
    const october = AnalyticsPeriod.monthOf(today);
    expect(S.periodInSpan(october, AnalyticsSpan.Week, today)).toEqual(
      AnalyticsPeriod.weekOf(today),
    );
    expect(
      S.periodInSpan(
        AnalyticsPeriod.monthOf(localDate('2026-08-01')),
        AnalyticsSpan.Week,
        today,
      ),
    ).toEqual(AnalyticsPeriod.weekOf(localDate('2026-08-31')));
    expect(
      S.periodInSpan(
        AnalyticsPeriod.weekOf(localDate('2026-08-31')),
        AnalyticsSpan.Month,
        today,
      ),
    ).toEqual(AnalyticsPeriod.monthOf(localDate('2026-09-01')));
    expect(S.periodInSpan(october, AnalyticsSpan.Month, today)).toBe(october);
    // A week at the reach's first days: its month would be out of reach.
    const reach = AnalyticsPeriod.weekOf(localDate('2025-10-06'));
    expect(S.periodInSpan(reach, AnalyticsSpan.Month, today)).toEqual(
      AnalyticsPeriod.monthOf(localDate('2025-10-01')),
    );
  });

  it('stepsOf — a DAY steps by one day, never past today, never before the reach', () => {
    const today = localDate('2026-10-14');
    expect(S.stepsOf(AnalyticsPeriod.dayOf(today), today)).toEqual({
      previous: AnalyticsPeriod.dayOf(localDate('2026-10-13')),
      next: null,
    });
    expect(
      S.stepsOf(AnalyticsPeriod.dayOf(localDate('2026-10-13')), today).next,
    ).toEqual(AnalyticsPeriod.dayOf(today));
    // The reach's first day.
    expect(
      S.stepsOf(AnalyticsPeriod.dayOf(localDate('2025-10-01')), today),
    ).toEqual({
      previous: null,
      next: AnalyticsPeriod.dayOf(localDate('2025-10-02')),
    });
  });

  it('periodInSpan — to a DAY: today when inside the period, else its first day; from a DAY: the week or month holding it', () => {
    const today = localDate('2026-10-14');
    const october = AnalyticsPeriod.monthOf(today);
    expect(S.periodInSpan(october, AnalyticsSpan.Day, today)).toEqual(
      AnalyticsPeriod.dayOf(today),
    );
    expect(
      S.periodInSpan(AnalyticsPeriod.weekOf(today), AnalyticsSpan.Day, today),
    ).toEqual(AnalyticsPeriod.dayOf(today));
    expect(
      S.periodInSpan(
        AnalyticsPeriod.monthOf(localDate('2026-08-01')),
        AnalyticsSpan.Day,
        today,
      ),
    ).toEqual(AnalyticsPeriod.dayOf(localDate('2026-08-01')));
    expect(
      S.periodInSpan(
        AnalyticsPeriod.weekOf(localDate('2026-08-31')),
        AnalyticsSpan.Day,
        today,
      ),
    ).toEqual(AnalyticsPeriod.dayOf(localDate('2026-08-31')));
    // Back: Wednesday 2 September lands in its week and its month.
    const wednesday = AnalyticsPeriod.dayOf(localDate('2026-09-02'));
    expect(S.periodInSpan(wednesday, AnalyticsSpan.Week, today)).toEqual(
      AnalyticsPeriod.weekOf(localDate('2026-08-31')),
    );
    expect(S.periodInSpan(wednesday, AnalyticsSpan.Month, today)).toEqual(
      AnalyticsPeriod.monthOf(localDate('2026-09-01')),
    );
    expect(S.periodInSpan(wednesday, AnalyticsSpan.Day, today)).toBe(wednesday);
    // Today's day lands on this week and this month.
    expect(
      S.periodInSpan(AnalyticsPeriod.dayOf(today), AnalyticsSpan.Week, today),
    ).toEqual(AnalyticsPeriod.weekOf(today));
    expect(
      S.periodInSpan(AnalyticsPeriod.dayOf(today), AnalyticsSpan.Month, today),
    ).toEqual(october);
  });

  it('seatRowsTotalOf / rebookedCountOf — a drill-down’s footer equals its figure', () => {
    const takings = S.seatRowsFor(report, AnalyticsFigure.Takings, NO_FILTER);
    expect(S.seatRowsTotalOf(takings, AnalyticsFigure.Takings)).toEqual({
      totalCents: report.reportTakingsCents,
      rowCount: 2,
    });
    const tips = S.seatRowsFor(report, AnalyticsFigure.Tips, NO_FILTER);
    expect(S.seatRowsTotalOf(tips, AnalyticsFigure.Tips).totalCents).toBe(
      report.reportTipsCents,
    );
    const noShows = S.seatRowsFor(report, AnalyticsFigure.NoShows, NO_FILTER);
    expect(S.seatRowsTotalOf(noShows, AnalyticsFigure.NoShows)).toEqual({
      totalCents: 0,
      rowCount: report.reportNoShowCount,
    });
    const rebooked = S.seatRowsFor(report, AnalyticsFigure.Rebooked, NO_FILTER);
    expect(rebooked).toHaveLength(report.reportRebookedBase);
    expect(S.rebookedCountOf(rebooked)).toBe(report.reportRebookedCount);
  });

  it('scopeMenuOf — the admin’s own record first, then the others; the shops to tick when there are two or more', () => {
    const centre = LocationId.of('loc-centre');
    const mladost = LocationId.of('loc-mladost');
    expect(S.scopeMenuOf([ivan, niko], niko, [centre, mladost])).toEqual({
      locationIds: [centre, mladost],
      barbers: [
        { barberId: niko, scopeMine: true },
        { barberId: ivan, scopeMine: false },
      ],
    });
    // With one shop, it IS the shop (ADR 2026-11-09, L4).
    expect(S.scopeMenuOf([ivan, niko], null, [centre])).toEqual({
      locationIds: [],
      barbers: [
        { barberId: ivan, scopeMine: false },
        { barberId: niko, scopeMine: false },
      ],
    });
  });

  it('is pure — the report it reads is left as it was', () => {
    const before = JSON.stringify(report);
    S.barSegmentsOf(report);
    S.screenOf(report);
    S.heroChangeOf(report);
    S.serviceSharesOf(report);
    expect(JSON.stringify(report)).toBe(before);
    expect(S.barSegmentsOf(report)).toEqual(S.barSegmentsOf(report));
  });
});

const NO_FILTER = { serviceId: null, localDate: null } as const;

describe('StaffAnalyticsSystem.seriesAverageCentsOf — the line’s dashed rule', () => {
  it('is the rounded mean of the series’ points, in whole cents', () => {
    const report = deepFreeze(analyticsReportFixture());
    const sum = report.reportSeries.reduce(
      (acc, point) => acc + point.takingsCents,
      0,
    );
    expect(StaffAnalyticsSystem.seriesAverageCentsOf(report)).toBe(
      Math.round(sum / report.reportSeries.length),
    );
  });

  it('is null with no points', () => {
    const report = deepFreeze({
      ...analyticsReportFixture(),
      reportSeries: [],
    });
    expect(StaffAnalyticsSystem.seriesAverageCentsOf(report)).toBeNull();
  });
});

/*
 * STAFF ANALYTICS v2, PR 4b — the stored days beside the live ones, the
 * YEAR and CUSTOM spans (`docs/designs/staff-analytics-v2.md`, Pipelines ·
 * `staffAnalytics`; The callable v2 contract).
 */
describe('StaffAnalyticsSystem.report — stored days beside live days (v2)', () => {
  const cents = (raw: number): PriceCents => raw as PriceCents;
  const m = (raw: number): MinuteCount => raw as MinuteCount;
  /** A stored day of `barberId` on `localDay` — zeros unless overridden. */
  const stored = (
    barberId: BarberId,
    localDay: LocalDate,
    overrides: Partial<DayFigures> = {},
  ): DayFigures => ({
    ...DayFigures.empty(barberId, localDay, stamp),
    ...overrides,
  });

  it('counts a barber-day from its stored figures, never from its visits or its cut day too', () => {
    const storedDay = stored(ivan, day(-5), {
      dayRosteredMinutes: m(540),
      dayWorkedMinutes: m(60),
      dayUnsoldMinutes: m(480),
      dayTakingsCents: cents(3000),
      dayTipsCents: cents(200),
      dayWorkedSeatCount: 1,
      dayNoShowBase: 1,
      dayRebookedBase: 1,
      dayRebookedCount: 1,
      dayStaffVisitCount: 1,
      dayServices: [
        {
          serviceId: cut,
          workedSeatCount: 1,
          takingsCents: cents(3000),
          serviceMinutes: m(60),
        },
      ],
    });
    const report = S.report(
      input({
        pastDays: [storedDay],
        visits: [
          // On the stored day: a visit the document already counts.
          visit('held', day(-5), [seat(ivan, 9999)]),
          // A live past day with no document, and today.
          visit('live', day(-2), [seat(ivan, 2000, undefined, cut, 10, 100)]),
          visit('now', TODAY, [seat(ivan, 500, undefined, beard, 10)]),
        ],
        days: [
          // The stored day's cut day is not counted either.
          dayOf(ivan, day(-5), { rosteredMinutes: 540, workedMinutes: 999 }),
          dayOf(ivan, day(-2), { rosteredMinutes: 480, workedMinutes: 30 }),
          dayOf(ivan, TODAY, { rosteredMinutes: 480, workedMinutes: 30 }),
        ],
      }),
    );
    expect(report.reportTakingsCents).toBe(3000 + 2000 + 500);
    expect(report.reportTipsCents).toBe(200 + 100);
    expect(report.reportRosteredMinutes).toBe(540 + 480 + 480);
    expect(report.reportWorkedMinutes).toBe(60 + 30 + 30);
    // The document's rebooking is final; the live past day joins the base.
    expect(report.reportRebookedBase).toBe(2);
    expect(report.reportRebookedCount).toBe(1);
    expect(report.reportNoShowBase).toBe(3);
    // The document's staff-booked visit, the two live online ones; the held visit not again.
    expect(report.reportOrigins).toEqual([
      { bookingOrigin: BookingOrigin.Online, visitCount: 2 },
      { bookingOrigin: BookingOrigin.Staff, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Unknown, visitCount: 0 },
    ]);
    // The series: the document's day, the live days.
    const point = (localDay: LocalDate) =>
      report.reportSeries.find((p) => p.localDate === localDay);
    expect(point(day(-5))?.takingsCents).toBe(3000);
    expect(point(day(-2))?.takingsCents).toBe(2000);
    expect(point(TODAY)?.takingsCents).toBe(500);
    // The services merge the document's row with the live seats.
    expect(report.reportServices).toEqual([
      {
        serviceId: cut,
        workedSeatCount: 2,
        takingsCents: 5000,
        serviceMinutes: 90,
        takingsPerHourCents: Math.round((5000 * 60) / 90),
      },
      {
        serviceId: beard,
        workedSeatCount: 1,
        takingsCents: 500,
        serviceMinutes: 30,
        takingsPerHourCents: 1000,
      },
    ]);
    // The rows: the document's as held, the live days' folds.
    expect(report.reportDayRows.map((row) => row.localDate)).toEqual([
      day(-5),
      day(-2),
      TODAY,
    ]);
    expect(report.reportDayRows[0]).toEqual(DayFigures.rowOf(storedDay));
    expect(report.reportDayRows[1]?.dayTakingsCents).toBe(2000);
    // One past day computed live — the one without a document.
    expect(report.reportMissingDays).toBe(1);
    // The hero: today cut at 14:00 (the 10:00 seat has ended), the rest as held.
    expect(report.reportHeroCurrentCents).toBe(3000 + 2000 + 500);
  });

  it('cuts the counterpart day from its visits at the current minute, however the comparison period holds it', () => {
    // October against September: today the 14th, its counterpart 14 September.
    const counterpart = localDate('2026-09-14');
    const report = S.report(
      input({
        previousPastDays: [
          stored(ivan, counterpart, {
            dayTakingsCents: cents(7000),
            dayWorkedSeatCount: 1,
          }),
          stored(ivan, localDate('2026-09-13'), {
            dayTakingsCents: cents(1000),
            dayWorkedSeatCount: 1,
          }),
        ],
        previousVisits: [
          // Ended by 14:00 — counted; after it — not yet.
          visit('p1', counterpart, [seat(ivan, 1500, undefined, cut, 10)]),
          visit('p2', counterpart, [seat(ivan, 500, undefined, cut, 15)]),
        ],
      }),
    );
    // The 13th from its document, the 14th from its visits up to 14:00.
    expect(report.reportHeroPreviousCents).toBe(1000 + 1500);
    // The line charts the whole counterpart day as held.
    expect(report.reportSeries[13]?.comparisonTakingsCents).toBe(7000);
    expect(report.reportSeries[12]?.comparisonTakingsCents).toBe(1000);
  });

  it('is pure with stored days: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(
      input({
        pastDays: [stored(ivan, day(-5), { dayTakingsCents: cents(3000) })],
        visits: [visit('a1', day(-2), [seat(ivan, 2000)])],
        days: [dayOf(ivan, day(-2), { rosteredMinutes: 600 })],
      }),
    );
    expect(S.report(frozen)).toEqual(S.report(frozen));
  });
});

describe('StaffAnalyticsSystem — the YEAR and CUSTOM spans (v2)', () => {
  const cents = (raw: number): PriceCents => raw as PriceCents;
  const year = AnalyticsPeriod.yearOf(TODAY);
  const quarterPlus = AnalyticsPeriod.customOf(
    localDate('2026-01-01'),
    localDate('2026-04-04'),
  );
  const fortnight = AnalyticsPeriod.customOf(
    localDate('2026-09-07'),
    localDate('2026-09-20'),
  );

  it('charts and lists a YEAR per month: twelve points, the comparison aligned by month, rows per barber-month', () => {
    expect(S.seriesStartsOf(year)).toEqual(
      LocalDate.range(localDate('2026-01-01'), localDate('2026-12-01')).filter(
        (d) => d.endsWith('-01'),
      ),
    );
    const report = S.report(
      input({
        period: year,
        pastDays: [
          {
            ...DayFigures.empty(ivan, localDate('2026-03-10'), stamp),
            dayTakingsCents: cents(3000),
            dayWorkedMinutes: 60 as MinuteCount,
          },
          {
            ...DayFigures.empty(ivan, localDate('2026-03-20'), stamp),
            dayTakingsCents: cents(1000),
          },
        ],
        visits: [visit('oct', day(-2), [seat(ivan, 2000)])],
        days: [
          dayOf(ivan, day(-2), { rosteredMinutes: 600, workedMinutes: 30 }),
        ],
        // Not comparable (2025 starts before the reach): no comparison at all.
      }),
    );
    expect(report.reportSeries).toHaveLength(12);
    expect(report.reportSeries[2]).toMatchObject({
      localDate: localDate('2026-03-01'),
      takingsCents: 4000,
      tipsCents: 0,
      comparisonTakingsCents: null,
    });
    expect(report.reportSeries[9]?.takingsCents).toBe(2000);
    expect(report.reportTimeSeries).toHaveLength(12);
    expect(report.reportTimeSeries[2]?.workedMinutes).toBe(60);
    expect(report.reportTimeSeries[9]?.workedMinutes).toBe(30);
    // The day rows: one per barber-month, filed under the month's first day.
    expect(report.reportDayRows.map((row) => row.localDate)).toEqual([
      localDate('2026-03-01'),
      localDate('2026-10-01'),
    ]);
    expect(report.reportDayRows[0]).toMatchObject({
      barberId: ivan,
      dayTakingsCents: 4000,
      dayWorkedMinutes: 60,
    });
    expect(report.reportDayRows[1]).toMatchObject({
      barberId: ivan,
      dayTakingsCents: 2000,
      dayRosteredMinutes: 600,
    });
    expect(S.dayRowsAreMonths(report)).toBe(true);
    expect(report.reportComparisonFromLocalDate).toBeNull();
  });

  it('charts a CUSTOM range per day up to 93 days and per ISO week beyond, the comparison aligned by position', () => {
    expect(S.seriesStartsOf(fortnight)).toEqual(
      AnalyticsPeriod.days(fortnight),
    );
    const starts = S.seriesStartsOf(quarterPlus);
    expect(starts).toHaveLength(14);
    expect(starts[0]).toBe('2026-01-01');
    expect(starts.slice(1).every((d) => LocalDate.weekday(d) === 1)).toBe(true);
    // Read on 10 April 2026, so the comparison (from 29 September 2025) is in reach.
    const april = localDate('2026-04-10');
    const report = S.report(
      input({
        period: quarterPlus,
        now: { ...NOW, localDate: april },
        visits: [visit('w0', localDate('2026-01-03'), [seat(ivan, 1000)])],
        previousVisits: [
          // The comparison: the 94 days ending 31 December 2025, cut into
          // its own weeks — its first bucket runs from Monday 29 September.
          visit('c0', localDate('2025-09-29'), [seat(ivan, 700)]),
        ],
        days: [dayOf(ivan, localDate('2026-01-03'), { workedMinutes: 30 })],
      }),
    );
    expect(AnalyticsPeriod.previous(quarterPlus)).toEqual(
      AnalyticsPeriod.customOf(
        localDate('2025-09-29'),
        localDate('2025-12-31'),
      ),
    );
    expect(report.reportSeries[0]).toMatchObject({
      localDate: localDate('2026-01-01'),
      takingsCents: 1000,
      tipsCents: 0,
      comparisonTakingsCents: 700,
    });
    expect(report.reportSeries).toHaveLength(14);
    expect(report.reportTimeSeries[0]?.workedMinutes).toBe(30);
    // Rows per month beyond 93 days.
    expect(report.reportDayRows.map((row) => row.localDate)).toEqual([
      localDate('2026-01-01'),
    ]);
    expect(S.dayRowsAreMonths(report)).toBe(true);
  });

  it('dayRowsAreMonths — only past 93 days: false for a DAY, WEEK, MONTH and a short CUSTOM range', () => {
    const of = (period: AnalyticsPeriod) =>
      S.dayRowsAreMonths(S.report(input({ period })));
    expect(of(AnalyticsPeriod.dayOf(TODAY))).toBe(false);
    expect(of(AnalyticsPeriod.weekOf(TODAY))).toBe(false);
    expect(of(OCTOBER)).toBe(false);
    expect(of(fortnight)).toBe(false);
    expect(
      of(
        AnalyticsPeriod.customOf(
          localDate('2026-01-01'),
          localDate('2026-04-03'),
        ),
      ),
    ).toBe(false);
    expect(of(quarterPlus)).toBe(true);
    expect(of(year)).toBe(true);
    // The rule reads the report's own range, not its span.
    expect(
      S.dayRowsAreMonths({
        ...analyticsReportFixture(),
        reportFromLocalDate: localDate('2026-01-01'),
        reportToLocalDate: localDate('2026-04-04'),
      }),
    ).toBe(true);
  });

  it('stepsOf — a YEAR steps by a year inside the reach, a CUSTOM range by its own length', () => {
    // 14 October 2026: last year starts before the reach, next year after today.
    expect(S.stepsOf(year, TODAY)).toEqual({ previous: null, next: null });
    // 15 January 2026: the reach is 1 January 2025, so 2025 is a step back.
    const january = localDate('2026-01-15');
    expect(S.stepsOf(AnalyticsPeriod.yearOf(january), january)).toEqual({
      previous: AnalyticsPeriod.yearOf(localDate('2025-06-01')),
      next: null,
    });
    expect(S.stepsOf(fortnight, TODAY)).toEqual({
      previous: AnalyticsPeriod.customOf(
        localDate('2026-08-24'),
        localDate('2026-09-06'),
      ),
      next: AnalyticsPeriod.customOf(
        localDate('2026-09-21'),
        localDate('2026-10-04'),
      ),
    });
    // Forward is disabled once the next range would start after today.
    expect(
      S.stepsOf(AnalyticsPeriod.customOf(localDate('2026-10-01'), TODAY), TODAY)
        .next,
    ).toBeNull();
    // Backward is disabled once the previous range would start before the reach.
    expect(
      S.stepsOf(
        AnalyticsPeriod.customOf(
          localDate('2025-10-01'),
          localDate('2025-10-14'),
        ),
        TODAY,
      ).previous,
    ).toBeNull();
  });

  it('periodInSpan — to a YEAR the year holding the first day; from a YEAR the week or month holding its first day; to CUSTOM nothing changes', () => {
    expect(S.periodInSpan(OCTOBER, AnalyticsSpan.Year, TODAY)).toEqual(year);
    expect(
      S.periodInSpan(AnalyticsPeriod.dayOf(TODAY), AnalyticsSpan.Year, TODAY),
    ).toEqual(year);
    // A week straddling the year's edge: its first day's year is out of reach — this year.
    expect(
      S.periodInSpan(
        AnalyticsPeriod.weekOf(localDate('2025-12-29')),
        AnalyticsSpan.Year,
        TODAY,
      ),
    ).toEqual(year);
    expect(S.periodInSpan(year, AnalyticsSpan.Month, TODAY)).toEqual(
      AnalyticsPeriod.monthOf(localDate('2026-01-01')),
    );
    expect(S.periodInSpan(year, AnalyticsSpan.Week, TODAY)).toEqual(
      AnalyticsPeriod.weekOf(localDate('2026-01-01')),
    );
    // A running year to a DAY is today.
    expect(S.periodInSpan(year, AnalyticsSpan.Day, TODAY)).toEqual(
      AnalyticsPeriod.dayOf(TODAY),
    );
    // To CUSTOM: the sheet opens; the period changes only on «Приложи».
    for (const period of [OCTOBER, year, AnalyticsPeriod.dayOf(TODAY)]) {
      expect(S.periodInSpan(period, AnalyticsSpan.Custom, TODAY)).toBe(period);
    }
    // From a CUSTOM range: the week or month holding its last day, or today.
    expect(S.periodInSpan(fortnight, AnalyticsSpan.Month, TODAY)).toEqual(
      AnalyticsPeriod.monthOf(localDate('2026-09-01')),
    );
    expect(S.periodInSpan(fortnight, AnalyticsSpan.Week, TODAY)).toEqual(
      AnalyticsPeriod.weekOf(localDate('2026-09-20')),
    );
    expect(S.periodInSpan(fortnight, AnalyticsSpan.Year, TODAY)).toEqual(year);
  });
});

describe('StaffAnalyticsSystem — the month goal (v2 PR 6)', () => {
  const cents = (raw: number): PriceCents => raw as PriceCents;
  /** Ivan's October: 1 800–2 200 €. */
  const GOAL: AnalyticsGoal = {
    barberId: ivan,
    goalMonth: MonthKey.of('2026-10'),
    goalLowCents: cents(180_000),
    goalHighCents: cents(220_000),
    currency: Currency.EUR,
    goalSetByUserId: UserId.of('u-ivan'),
    goalSetAtUtcMs: stamp,
  };
  const rostered = { rosteredMinutes: 480, unsoldMinutes: 480 };
  const nine = [MinuteRange.of(minute(540), endMinute(1020))];
  /** `barberId` rostered on each of `dates` (a stretch 09:00–17:00). */
  const rosteredDays = (barberId: BarberId, dates: readonly string[]) =>
    dates.map((d) => dayOf(barberId, localDate(d), rostered, nine));

  describe('goalPaceOf — the contract’s formula', () => {
    it('is NONE without a goal, before the first rostered day is worked, and with no rostered day in the month', () => {
      expect(S.goalPaceOf(cents(50_000), null, 10, 22)).toBe(GoalPaceTag.None);
      expect(S.goalPaceOf(cents(50_000), GOAL, 0, 22)).toBe(GoalPaceTag.None);
      expect(S.goalPaceOf(cents(50_000), GOAL, 0, 0)).toBe(GoalPaceTag.None);
    });

    it('paces the takings against the goal scaled by the days worked over the days rostered — the bounds inclusive', () => {
      // 12 of 22 days: expected 98 181,8… – 120 000,0 cents.
      expect(S.goalPaceOf(cents(120_000), GOAL, 12, 22)).toBe(
        GoalPaceTag.Ahead,
      );
      expect(S.goalPaceOf(cents(119_999), GOAL, 12, 22)).toBe(
        GoalPaceTag.OnTrack,
      );
      expect(S.goalPaceOf(cents(98_182), GOAL, 12, 22)).toBe(
        GoalPaceTag.OnTrack,
      );
      expect(S.goalPaceOf(cents(98_181), GOAL, 12, 22)).toBe(
        GoalPaceTag.Behind,
      );
      expect(S.goalPaceOf(cents(0), GOAL, 12, 22)).toBe(GoalPaceTag.Behind);
      // Every day worked: the whole goal.
      expect(S.goalPaceOf(cents(220_000), GOAL, 22, 22)).toBe(
        GoalPaceTag.Ahead,
      );
      expect(S.goalPaceOf(cents(180_000), GOAL, 22, 22)).toBe(
        GoalPaceTag.OnTrack,
      );
      expect(S.goalPaceOf(cents(179_999), GOAL, 22, 22)).toBe(
        GoalPaceTag.Behind,
      );
    });

    it('is pure: same input → same output, the goal untouched', () => {
      const frozen = deepFreeze({ ...GOAL });
      expect(S.goalPaceOf(cents(100_000), frozen, 12, 22)).toBe(
        S.goalPaceOf(cents(100_000), frozen, 12, 22),
      );
      expect(frozen).toEqual(GOAL);
    });
  });

  describe('goalScopeAllowed — the shop’s goal, or one’s own record’s', () => {
    it('admits the shop and the account’s own record, refuses a colleague’s', () => {
      expect(S.goalScopeAllowed([], ivan, [])).toBe(true);
      expect(S.goalScopeAllowed([], null, [])).toBe(true);
      expect(S.goalScopeAllowed([ivan], ivan, [])).toBe(true);
      expect(S.goalScopeAllowed([niko], ivan, [])).toBe(false);
      expect(S.goalScopeAllowed([niko], null, [])).toBe(false);
      // A part of the team has no goal, nor does a location (ADR 2026-11-09, L5).
      expect(S.goalScopeAllowed([ivan, niko], ivan, [])).toBe(false);
      expect(S.goalScopeAllowed([], ivan, [LocationId.of('loc-centre')])).toBe(
        false,
      );
      expect(S.scopeHasGoal([], [])).toBe(true);
      expect(S.scopeHasGoal([ivan], [])).toBe(true);
      expect(S.scopeHasGoal([ivan, niko], [])).toBe(false);
      expect(S.scopeHasGoal([], [LocationId.of('loc-centre')])).toBe(false);
    });
  });

  describe('goalMonthAllowed and goalMonthOffered — the current or the next month', () => {
    it('admits today’s month and the one after it, no other', () => {
      expect(S.goalMonthAllowed(MonthKey.of('2026-10'), TODAY)).toBe(true);
      expect(S.goalMonthAllowed(MonthKey.of('2026-11'), TODAY)).toBe(true);
      for (const month of ['2026-09', '2026-12', '2027-10', '2025-10']) {
        expect(S.goalMonthAllowed(MonthKey.of(month), TODAY)).toBe(false);
      }
      // December's next month is next year's January.
      expect(
        S.goalMonthAllowed(MonthKey.of('2027-01'), localDate('2026-12-31')),
      ).toBe(true);
    });

    it('offers «Задай цел» on the current and the next MONTH only — never another span, never a past or farther month', () => {
      expect(S.goalMonthOffered(OCTOBER, TODAY)).toBe(true);
      expect(
        S.goalMonthOffered(
          AnalyticsPeriod.monthOf(localDate('2026-11-01')),
          TODAY,
        ),
      ).toBe(true);
      expect(
        S.goalMonthOffered(
          AnalyticsPeriod.monthOf(localDate('2026-09-01')),
          TODAY,
        ),
      ).toBe(false);
      expect(
        S.goalMonthOffered(
          AnalyticsPeriod.monthOf(localDate('2026-12-01')),
          TODAY,
        ),
      ).toBe(false);
      expect(S.goalMonthOffered(AnalyticsPeriod.weekOf(TODAY), TODAY)).toBe(
        false,
      );
      expect(S.goalMonthOffered(AnalyticsPeriod.dayOf(TODAY), TODAY)).toBe(
        false,
      );
      expect(S.goalMonthOffered(AnalyticsPeriod.yearOf(TODAY), TODAY)).toBe(
        false,
      );
      expect(
        S.goalMonthOffered(
          AnalyticsPeriod.customOf(
            localDate('2026-10-01'),
            localDate('2026-10-31'),
          ),
          TODAY,
        ),
      ).toBe(false);
    });
  });

  describe('report — the goal fields', () => {
    it('hands the goal’s range back on a MONTH with the days worked so far, the month’s rostered days and the pace', () => {
      // Ivan rostered on 12 past-or-today weekdays and 10 later ones: 22 in all, 12 so far.
      const soFar = [
        '01',
        '02',
        '05',
        '06',
        '07',
        '08',
        '09',
        '12',
        '13',
        '14',
      ];
      const later = [
        '15',
        '16',
        '19',
        '20',
        '21',
        '22',
        '23',
        '26',
        '27',
        '28',
      ];
      const dates = [...soFar, ...later].map((d) => `2026-10-${d}`);
      const report = S.report(
        input({
          goal: GOAL,
          days: rosteredDays(ivan, dates),
          // 1 200,00 € worked — the expected high at 10 of 20 days is 1 100,00 €.
          visits: [
            visit('v-1', localDate('2026-10-05'), [seat(ivan, 120_000)]),
          ],
        }),
      );
      expect(report).toMatchObject({
        reportGoalLowCents: 180_000,
        reportGoalHighCents: 220_000,
        reportGoalDaysSoFar: 10,
        reportGoalDaysInMonth: 20,
        reportGoalPaceTag: GoalPaceTag.Ahead,
      });
    });

    it('counts a stored past day with rostered minutes beside the live days, and never a day without a stretch', () => {
      const stored = {
        ...DayFigures.empty(ivan, localDate('2026-10-01'), stamp),
        dayRosteredMinutes: 480 as MinuteCount,
      };
      const report = S.report(
        input({
          goal: GOAL,
          pastDays: [stored],
          days: [
            ...rosteredDays(ivan, ['2026-10-02', '2026-10-20']),
            // A closed day: no stretch, no rostered minute — not a goal day.
            dayOf(ivan, localDate('2026-10-03')),
          ],
        }),
      );
      expect(report.reportGoalDaysSoFar).toBe(2);
      expect(report.reportGoalDaysInMonth).toBe(3);
      // Nothing taken yet: behind the expected low.
      expect(report.reportGoalPaceTag).toBe(GoalPaceTag.Behind);
    });

    it('on the shop scope a day counts ONCE when any barber has a stretch', () => {
      const report = S.report(
        input({
          scopeBarberIds: [],
          barberIds: [ivan, niko],
          goal: { ...GOAL, barberId: null },
          days: [
            ...rosteredDays(ivan, ['2026-10-05', '2026-10-06']),
            ...rosteredDays(niko, ['2026-10-05', '2026-10-20']),
          ],
        }),
      );
      expect(report.reportGoalDaysSoFar).toBe(2);
      expect(report.reportGoalDaysInMonth).toBe(3);
    });

    it('carries no goal — null bounds, NONE and zero days — without one, and off MONTH even when one is handed in', () => {
      const none = S.report(
        input({ days: rosteredDays(ivan, ['2026-10-05']) }),
      );
      expect(none).toMatchObject({
        reportGoalLowCents: null,
        reportGoalHighCents: null,
        reportGoalPaceTag: GoalPaceTag.None,
        reportGoalDaysSoFar: 1,
        reportGoalDaysInMonth: 1,
      });
      for (const period of [
        AnalyticsPeriod.weekOf(TODAY),
        AnalyticsPeriod.dayOf(TODAY),
        AnalyticsPeriod.yearOf(TODAY),
        AnalyticsPeriod.customOf(
          localDate('2026-10-01'),
          localDate('2026-10-31'),
        ),
      ]) {
        const report = S.report(
          input({
            period,
            goal: GOAL,
            days: rosteredDays(ivan, ['2026-10-05']),
          }),
        );
        expect(report).toMatchObject({
          reportGoalLowCents: null,
          reportGoalHighCents: null,
          reportGoalPaceTag: GoalPaceTag.None,
          reportGoalDaysSoFar: 0,
          reportGoalDaysInMonth: 0,
        });
      }
    });
  });
});

describe('StaffAnalyticsSystem.newClientCountOf — the period’s new clients', () => {
  const centre = LocationId.of('loc-centre');
  const mladost = LocationId.of('loc-mladost');
  const seen = (
    id: string,
    day: string | null,
    barbers: readonly BarberId[],
    location: LocationId | null,
  ) => ({
    customerId: CustomerId.of(id),
    firstVisitLocalDate: day === null ? null : localDate(day),
    firstVisitBarberIds: barbers,
    firstVisitLocationId: location,
  });
  const records = [
    seen('c-1', '2026-10-03', [ivan], centre),
    seen('c-2', '2026-10-20', [niko], mladost),
    seen('c-3', '2026-10-31', [ivan, niko], centre),
    seen('c-4', '2026-09-30', [ivan], centre),
    seen('c-5', null, [], null),
  ];

  it('counts each client first seen in the period: the shop’s all, a barber’s with them, a location’s there', () => {
    expect(S.newClientCountOf(records, [], [], OCTOBER)).toBe(3);
    expect(S.newClientCountOf(records, [ivan], [], OCTOBER)).toBe(2);
    expect(S.newClientCountOf(records, [niko], [], OCTOBER)).toBe(2);
    expect(S.newClientCountOf(records, [ivan, niko], [], OCTOBER)).toBe(3);
    expect(S.newClientCountOf(records, [], [mladost], OCTOBER)).toBe(1);
    expect(S.newClientCountOf(records, [], [centre, mladost], OCTOBER)).toBe(3);
    expect(S.newClientCountOf(records, [niko], [centre], OCTOBER)).toBe(1);
    expect(S.newClientCountOf([], [], [], OCTOBER)).toBe(0);
  });

  it('starts the read at the comparison period when a shop radar is drawn against it, else at the period', () => {
    const september = localDate('2026-09-01');
    expect(S.firstSeenFromOf(OCTOBER, TODAY, [])).toBe(september);
    // A barber's report draws no radar; neither does a WEEK or a DAY.
    expect(S.firstSeenFromOf(OCTOBER, TODAY, [ivan])).toBe(
      OCTOBER.fromLocalDate,
    );
    const week = AnalyticsPeriod.weekOf(TODAY);
    expect(S.firstSeenFromOf(week, TODAY, [])).toBe(week.fromLocalDate);
    // A YEAR whose comparison is out of reach has none to read.
    const year = AnalyticsPeriod.yearOf(TODAY);
    expect(S.firstSeenFromOf(year, TODAY, [])).toBe(year.fromLocalDate);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(records);
    expect(S.newClientCountOf(frozen, [ivan], [], OCTOBER)).toBe(
      S.newClientCountOf(frozen, [ivan], [], OCTOBER),
    );
  });
});
