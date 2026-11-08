import { describe, expect, it } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsBarPart,
  AnalyticsFigure,
  AnalyticsPeriod,
  AnalyticsSpan,
  HeroChange,
  BookingLifecycle,
  BookingOrigin,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  ClientStatsPolicy,
  LocationStatus,
  MinuteRange,
  Placement,
  Role,
  Seat,
  SeatOutcome,
  type ShopNow,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  LocalDate,
  LocationId,
  MinuteCount,
  ScheduleExceptionId,
  SeatId,
  ServiceId,
  UserId,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
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
    ...parts,
  }) as AnalyticsDay;

function input(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    scopeBarberId: ivan,
    barberIds: [ivan],
    period: OCTOBER,
    days: [],
    aheadDays: [],
    visits: [],
    previousVisits: [],
    followUps: [],
    policy: ClientStatsPolicy.DEFAULT,
    now: NOW,
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
      AnalyticsPeriod.of(AnalyticsSpan.Week, localDate('2026-10-12')).ok,
    ).toBe(true);
    expect(AnalyticsPeriod.of(AnalyticsSpan.Week, TODAY)).toEqual({
      ok: false,
      error: { errorCode: 'ANALYTICS_INVALID_INPUT', field: 'fromLocalDate' },
    });
    expect(
      AnalyticsPeriod.of(AnalyticsSpan.Month, localDate('2026-10-02')).ok,
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
  const request = (scopeBarberId: BarberId | null): AnalyticsCall => ({
    scopeBarberId,
    fromLocalDate: OCTOBER.fromLocalDate,
    analyticsSpan: AnalyticsSpan.Month,
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
  ] as const)('%s', (_, who, asked, expected) => {
    const result = S.scopeOf(who, request(asked), known);
    if (typeof expected === 'string' && expected.startsWith('ANALYTICS_')) {
      expect(result.ok ? null : result.error.errorCode).toBe(expected);
    } else {
      expect(result).toEqual({ ok: true, value: expected });
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
    expect(S.report(input()).reportHeroPreviousCents).toBeNull();
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
            visit('w0', localDate('2026-01-03'), [seat(ivan, 1000)]),
            visit('w1', localDate('2026-01-05'), [seat(ivan, 2000)]),
            visit('w1b', localDate('2026-01-11'), [seat(ivan, 500)]),
            visit('wl', localDate('2026-04-04'), [seat(ivan, 300)]),
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
      expect(report.reportSeries[2]).toEqual({
        localDate: localDate('2026-03-03'),
        takingsCents: 4000,
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
          scopeBarberId: null,
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
        scopeBarberId: null,
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

  it('scopes the shop to every record by id, a barber to the one', () => {
    expect(S.barbersInScope(null, [niko, ivan])).toEqual([ivan, niko]);
    expect(S.barbersInScope(niko, [niko, ivan])).toEqual([niko]);
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

  it('scopeChoicesOf — the shop, then the admin’s own record, then the others', () => {
    expect(S.scopeChoicesOf([ivan, niko], niko)).toEqual([
      { scopeBarberId: null, scopeMine: false },
      { scopeBarberId: niko, scopeMine: true },
      { scopeBarberId: ivan, scopeMine: false },
    ]);
    expect(S.scopeChoicesOf([ivan, niko], null)).toEqual([
      { scopeBarberId: null, scopeMine: false },
      { scopeBarberId: ivan, scopeMine: false },
      { scopeBarberId: niko, scopeMine: false },
    ]);
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
