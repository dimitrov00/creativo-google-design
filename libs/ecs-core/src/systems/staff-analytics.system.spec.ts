import { describe, expect, it } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsFigure,
  AnalyticsPeriod,
  AnalyticsSpan,
  BookingLifecycle,
  BookingOrigin,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  ClientStatsPolicy,
  Placement,
  Role,
  Seat,
  SeatOutcome,
  type ShopNow,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  LocalDate,
  MinuteCount,
  SeatId,
  ServiceId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  deepFreeze,
  localDate,
  minute,
  seatFixture,
  termsFixture,
} from '@core/testing';
import type { ChairDay } from './chair-time.system';
import {
  type AnalyticsDay,
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
): AnalyticsDay =>
  ({
    barberId,
    localDate: localDay,
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
