import { describe, expect, it, vi } from 'vitest';
import {
  AnalyticsComparison,
  AnalyticsFigure,
  AnalyticsSpan,
  type AnalyticsReport,
  BookingOrigin,
  BookingPolicy,
  ClientStatsPolicy,
  DayFigures,
  type DayRow,
  FlagName,
  type Seat,
  SeatSubject,
} from '@core/components';
import type { BarberBusyDay } from '@core/entities';
import {
  AttendanceState,
  type BarberId,
  BusyKey,
  type CustomerId,
  type LocalDate,
  MinuteCount,
  type UserId,
} from '@core/primitives';
import {
  AnalyticsHourSystem,
  ChairTimeSystem,
  ClientStatsSystem,
  DayFiguresSystem,
  GridLayoutSystem,
  MoneyAllocation,
  MoneyAllocationSystem,
  PartyAdmissionSystem,
  RosterSystem,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  ANALYTICS_FIXTURE_BARBERS,
  type AnalyticsFixtureWorld,
  ANALYTICS_FIXTURE_CUSTOMERS,
  ANALYTICS_FIXTURE_DEPARTURES,
  ANALYTICS_FIXTURE_LOCATIONS,
  ANALYTICS_FIXTURE_MONTH,
  ANALYTICS_FIXTURE_ROSTERS,
  ANALYTICS_FIXTURE_USERS,
  ANALYTICS_FIXTURE_VISITS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  analyticsFixtureBusyDays,
  analyticsFixtureDayDocuments,
  analyticsFixtureDays,
  analyticsFixtureFollowUps,
  analyticsFixturePorts,
  localDate,
  unwrapOk,
} from '@core/testing';
import { staffAnalytics } from './staff-analytics.pipeline';

/*
 * G5 — NAMED FIGURES AGREE (docs/designs/staff-analytics.md), over ONE
 * fixture month (`analytics.fixtures.ts`): the schedule's free time and the
 * report's unsold + open, the client card's lifetime spend and the seat nets
 * behind takings, and every drill-down's rows and the figure they open from.
 * The reports are the pipeline's own, read through the in-memory ports that
 * answer as the Firestore adapter does.
 */

const { ivan, niko, maria } = ANALYTICS_FIXTURE_BARBERS;
const BARBERS = [ivan, niko, maria] as const;
const USER_OF = new Map<BarberId, UserId>([
  [ivan, ANALYTICS_FIXTURE_USERS.ivan.id],
  [niko, ANALYTICS_FIXTURE_USERS.niko.id],
  [maria, ANALYTICS_FIXTURE_USERS.maria.id],
]);
const NOW = ZonedTimeSystem.shopNow(FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE);
const BUSY: readonly BarberBusyDay[] = analyticsFixtureBusyDays();

/** The fixture month's report through the pipeline — every day live unless `world` stores days and turns the flag on. */
async function reportOf(
  callerUserId: UserId,
  scopeBarberId: BarberId | null,
  world: AnalyticsFixtureWorld = {},
): Promise<AnalyticsReport> {
  return unwrapOk(
    await staffAnalytics(analyticsFixturePorts(world))({
      callerUserId,
      scopeBarberId,
      analyticsSpan: AnalyticsSpan.Month,
      fromLocalDate: ANALYTICS_FIXTURE_MONTH,
      toLocalDate: null,
      analyticsComparison: AnalyticsComparison.Previous,
    }),
  );
}

/** Each barber's own report, asked by their linked account — the screen's path. */
async function barberReports(): Promise<
  ReadonlyMap<BarberId, AnalyticsReport>
> {
  const out = new Map<BarberId, AnalyticsReport>();
  for (const barberId of BARBERS) {
    const caller = USER_OF.get(barberId);
    if (caller === undefined) throw new Error(`no account for ${barberId}`);
    out.set(barberId, await reportOf(caller, barberId));
  }
  return out;
}

/**
 * THE SCHEDULE'S DAY-SUMMARY FREE MINUTES for one barber-day — the exact
 * call chain of the staff dashboard, which ecs-core cannot import (it lives
 * in `libs/features/staff/dashboard`):
 *
 * - `laneGeometryOf` (`staff-day.store.ts`): the day's offered windows,
 *   `RosterSystem.offeredWindows`, over the shops the catalogue lists
 *   (active ones only — `memoryCatalogReadPorts` / `observeLocations`), the
 *   day's ONE exception (`observeExceptions(busyKey)`), and the busy
 *   projection's blocks; no window → no geometry, nothing free;
 * - `StaffDayStore.dayGeometry`: `occupiedOn` →
 *   `GridLayoutSystem.occupiedIntervals(the day's visits, barber, busy)`,
 *   then `GridLayoutSystem.holes(rostered, occupied)`;
 * - `StaffDayStore.dayCells`: `GridLayoutSystem.sellableAt(holes, now, day)`;
 * - `StaffDashboard.daySummary`: `GridLayoutSystem.totalMinutes` over the
 *   lane's gap rows (one per gap, `gapRowVm`, its `minutes` the gap's).
 *
 * `staff-analytics.agreement.spec.ts` in the dashboard library runs the
 * store itself over the same fixture.
 */
function scheduleFreeMinutes(barberId: BarberId, day: LocalDate): MinuteCount {
  const schedule =
    ANALYTICS_FIXTURE_ROSTERS.find((entry) => entry.id === barberId) ?? null;
  if (schedule === null) return MinuteCount.ZERO;
  const key = BusyKey.of(barberId, day);
  const exception =
    ANALYTICS_FIXTURE_DEPARTURES.find(
      (entry) => BusyKey.of(entry.barberId, entry.localDate) === key,
    ) ?? null;
  const listed = ANALYTICS_FIXTURE_LOCATIONS.filter((location) =>
    PartyAdmissionSystem.shopListed(location),
  );
  const rostered = RosterSystem.offeredWindows({
    barberId,
    localDate: day,
    versions: schedule.versions,
    exceptions: exception === null ? [] : [exception],
    shopHours: RosterSystem.shopHoursOn(listed, day),
  });
  if (rostered.length === 0) return MinuteCount.ZERO;
  const busy =
    BUSY.find((entry) => BusyKey.of(entry.barberId, entry.localDate) === key)
      ?.blocks ?? [];
  const occupied = GridLayoutSystem.occupiedIntervals(
    ANALYTICS_FIXTURE_VISITS.filter((visit) => visit.localDate === day),
    barberId,
    busy,
  );
  const holes = GridLayoutSystem.holes(rostered, occupied);
  return GridLayoutSystem.totalMinutes(
    GridLayoutSystem.sellableAt(holes, NOW, day),
  );
}

describe('G5 — the schedule’s free time is unsold + open, every barber-day', () => {
  it('agrees on each of the month’s 90 barber-days, the hidden shop’s Saturdays included', async () => {
    const reports = await barberReports();
    let checked = 0;
    let free = 0;
    for (const barberId of BARBERS) {
      const report = reports.get(barberId) as AnalyticsReport;
      expect(report.reportDayRows).toHaveLength(30);
      for (const row of report.reportDayRows) {
        const schedule = scheduleFreeMinutes(barberId, row.localDate);
        expect(
          { barberId, localDate: row.localDate, free: schedule },
          `${barberId} ${row.localDate}`,
        ).toEqual({
          barberId,
          localDate: row.localDate,
          free: row.dayUnsoldMinutes + row.dayOpenMinutes,
        });
        checked++;
        free += schedule;
      }
    }
    expect(checked).toBe(90);
    expect(free).toBeGreaterThan(0);
  });

  it('agrees with ChairTimeSystem.dayBreakdown called on its own, and every day’s parts sum to its rostered time', async () => {
    const reports = await barberReports();
    for (const barberId of BARBERS) {
      for (const row of (reports.get(barberId) as AnalyticsReport)
        .reportDayRows) {
        const day = StaffAnalyticsSystem.daysOf({
          barberIds: [barberId],
          localDates: [row.localDate],
          rosters: ANALYTICS_FIXTURE_ROSTERS,
          departures: ANALYTICS_FIXTURE_DEPARTURES,
          locations: ANALYTICS_FIXTURE_LOCATIONS,
          visits: ANALYTICS_FIXTURE_VISITS,
          nowByLocation: ANALYTICS_FIXTURE_LOCATIONS.map((location) => ({
            locationId: location.id,
            ...NOW,
          })),
          now: NOW,
        })[0];
        expect(day?.unsoldMinutes).toBe(row.dayUnsoldMinutes);
        expect(day?.openMinutes).toBe(row.dayOpenMinutes);
        expect(day === undefined ? -1 : ChairTimeSystem.partsTotal(day)).toBe(
          row.dayRosteredMinutes,
        );
      }
    }
  });

  it('pins the edge days: the block, the break under a seat, the closed day, the hidden shop', async () => {
    const reports = await barberReports();
    const row = (barberId: BarberId, day: string) =>
      (reports.get(barberId) as AnalyticsReport).reportDayRows.find(
        (entry) => entry.localDate === localDate(day),
      );
    // Ivan's Friday the 18th: 2 h blocked out of his 9-hour day.
    expect(row(ivan, '2026-09-18')?.dayBlockedMinutes).toBe(120);
    // Monday the 14th: the beard over the 13:00 break is worked, the break gone.
    expect(row(ivan, '2026-09-14')?.dayBreakMinutes).toBe(0);
    expect(row(ivan, '2026-09-14')?.dayWorkedMinutes).toBe(60);
    // Niko's closed Friday rosters nothing and keeps what it would have.
    expect(row(niko, '2026-09-04')?.dayRosteredMinutes).toBe(0);
    expect(row(niko, '2026-09-04')?.dayClosedDayMinutes).toBe(540);
    // Maria's Saturday at the hidden shop: no rostered time, nothing free.
    expect(row(maria, '2026-09-19')?.dayRosteredMinutes).toBe(0);
    expect(scheduleFreeMinutes(maria, localDate('2026-09-19'))).toBe(0);
    // Today is cut at 09:00: Ivan's free time ahead of now is open.
    expect(row(ivan, '2026-09-28')?.dayOpenMinutes).toBeGreaterThan(0);
  });
});

describe('G5 — the client card’s lifetime spend and the seat nets, every client', () => {
  /** Σ seat nets (euro cents) of `customerId`'s worked seats, and how many seats that is. */
  function seatNetsOf(customerId: CustomerId): {
    readonly cents: number;
    readonly workedSeats: number;
  } {
    let cents = 0;
    let workedSeats = 0;
    for (const visit of ANALYTICS_FIXTURE_VISITS) {
      const nets = MoneyAllocationSystem.seatNets(visit);
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as Seat;
        if (
          seat.seatSubject === SeatSubject.Anonymous ||
          seat.subjectCustomerId !== customerId ||
          seat.attendanceState !== AttendanceState.Worked
        ) {
          continue;
        }
        workedSeats++;
        if (nets.moneyAllocation === MoneyAllocation.Allocated) {
          cents += nets.nets[s]?.netCents ?? 0;
        }
      }
    }
    return { cents, workedSeats };
  }

  it('differs by at most one cent per worked seat, the three-seat client and the leva visit included', () => {
    const billed = ClientStatsSystem.billedHistory(ANALYTICS_FIXTURE_VISITS);
    const differences: number[] = [];
    for (const customerId of ANALYTICS_FIXTURE_CUSTOMERS) {
      const card = ClientStatsSystem.money(customerId, billed);
      const seats = seatNetsOf(customerId);
      const difference = Math.abs(card.lifetimeSpendCents - seats.cents);
      expect(difference, customerId).toBeLessThanOrEqual(seats.workedSeats);
      differences.push(difference);
    }
    expect(differences).toHaveLength(6);
    // The three-seat client: the visit's odd cent went to the other seat,
    // so the card's per-visit rounding is one cent above the seat nets.
    expect(Math.max(...differences)).toBe(1);
  });
});

describe('G5 — every drill-down’s rows add up to its figure', () => {
  const FIGURES = Object.values(AnalyticsFigure);

  const none = { serviceId: null, localDate: null };

  /** `TIME`: the day rows' parts sum to the report's. */
  function expectDayRowsAgree(report: AnalyticsReport): void {
    const days = StaffAnalyticsSystem.dayRowsFor(report, none);
    const sum = (part: keyof DayRow): number =>
      days.reduce((total, day) => total + (day[part] as number), 0);
    expect({
      rostered: sum('dayRosteredMinutes'),
      worked: sum('dayWorkedMinutes'),
      noShow: sum('dayNoShowMinutes'),
      unmarked: sum('dayUnmarkedMinutes'),
      bookedAhead: sum('dayBookedAheadMinutes'),
      held: sum('dayHeldMinutes'),
      blocked: sum('dayBlockedMinutes'),
      breaks: sum('dayBreakMinutes'),
      shortGap: sum('dayShortGapMinutes'),
      unsold: sum('dayUnsoldMinutes'),
      open: sum('dayOpenMinutes'),
      closed: sum('dayClosedDayMinutes'),
    }).toEqual({
      rostered: report.reportRosteredMinutes,
      worked: report.reportWorkedMinutes,
      noShow: report.reportNoShowMinutes,
      unmarked: report.reportUnmarkedMinutes,
      bookedAhead: report.reportBookedAheadMinutes,
      held: report.reportHeldMinutes,
      blocked: report.reportBlockedMinutes,
      breaks: report.reportBreakMinutes,
      shortGap: report.reportShortGapMinutes,
      unsold: report.reportUnsoldMinutes,
      open: report.reportOpenMinutes,
      closed: report.reportClosedDayMinutes,
    });
  }

  /** Every seat figure: its rows' money or count is the figure. */
  function expectSeatRowsAgree(report: AnalyticsReport): void {
    for (const figure of FIGURES) {
      if (figure === AnalyticsFigure.Time) continue;
      const rows = StaffAnalyticsSystem.seatRowsFor(report, figure, none);
      const total = StaffAnalyticsSystem.seatRowsTotalOf(rows, figure);
      switch (figure) {
        case AnalyticsFigure.Takings:
          expect(total.totalCents, figure).toBe(report.reportTakingsCents);
          break;
        case AnalyticsFigure.Tips:
          expect(total.totalCents, figure).toBe(report.reportTipsCents);
          break;
        case AnalyticsFigure.NoShows:
          expect(total.rowCount, figure).toBe(report.reportNoShowCount);
          break;
        case AnalyticsFigure.LateCancellations:
          expect(total.rowCount, figure).toBe(
            report.reportLateCancellationCount,
          );
          break;
        case AnalyticsFigure.Rebooked:
          expect(total.rowCount, figure).toBe(report.reportRebookedBase);
          expect(StaffAnalyticsSystem.rebookedCountOf(rows), figure).toBe(
            report.reportRebookedCount,
          );
          break;
      }
    }
    // Seats by service: each service's takings rows sum to its row.
    for (const service of report.reportServices) {
      const rows = StaffAnalyticsSystem.seatRowsFor(
        report,
        AnalyticsFigure.Takings,
        { serviceId: service.serviceId, localDate: null },
      );
      expect(rows).toHaveLength(service.workedSeatCount);
      expect(
        StaffAnalyticsSystem.seatRowsTotalOf(rows, AnalyticsFigure.Takings)
          .totalCents,
      ).toBe(service.takingsCents);
    }
  }

  /** The charts (v2): each series' points sum to the figure they chart. */
  function expectChartsAgree(report: AnalyticsReport): void {
    const sum = <T>(rows: readonly T[], read: (row: T) => number): number =>
      rows.reduce((total, row) => total + read(row), 0);
    expect(sum(report.reportSeries, (p) => p.takingsCents)).toBe(
      report.reportTakingsCents,
    );
    expect({
      worked: sum(report.reportTimeSeries, (p) => p.workedMinutes),
      noShow: sum(report.reportTimeSeries, (p) => p.noShowMinutes),
      unmarked: sum(report.reportTimeSeries, (p) => p.unmarkedMinutes),
      blocked: sum(report.reportTimeSeries, (p) => p.blockedMinutes),
      unsold: sum(report.reportTimeSeries, (p) => p.unsoldMinutes),
      other: sum(report.reportTimeSeries, (p) => p.otherMinutes),
    }).toEqual({
      worked: report.reportBarWorkedMinutes,
      noShow: report.reportBarNoShowMinutes,
      unmarked: report.reportBarUnmarkedMinutes,
      blocked: report.reportBarBlockedMinutes,
      unsold: report.reportBarUnsoldMinutes,
      other: report.reportBarOtherMinutes,
    });
    // The hour grid buckets the same worked and rostered minutes the parts count.
    expect(sum(report.reportHourGrid, (c) => c.workedMinutes)).toBe(
      report.reportWorkedMinutes,
    );
    expect(sum(report.reportHourGrid, (c) => c.rosteredMinutes)).toBe(
      report.reportRosteredMinutes,
    );
    expect(sum(report.reportAheadDays, (d) => d.openMinutes)).toBe(
      report.reportBookableOpenMinutes,
    );
  }

  it('holds for every figure of each barber’s report', async () => {
    const reports = await barberReports();
    for (const report of reports.values()) {
      expectDayRowsAgree(report);
      expectSeatRowsAgree(report);
      expectChartsAgree(report);
    }
    // The fixture is not trivial: each figure has rows somewhere.
    const all = [...reports.values()];
    expect(all.some((report) => report.reportTakingsCents > 0)).toBe(true);
    expect(all.some((report) => report.reportTipsCents > 0)).toBe(true);
    expect(all.some((report) => report.reportNoShowCount > 0)).toBe(true);
    expect(all.some((report) => report.reportLateCancellationCount > 0)).toBe(
      true,
    );
    expect(all.some((report) => report.reportRebookedCount > 0)).toBe(true);
    expect(all.some((report) => report.reportHeldMinutes > 0)).toBe(true);
    expect(all.some((report) => report.reportUnmarkedMinutes > 0)).toBe(true);
  });

  // A shop report carries no seat rows: its seat figures drill to the
  // per-barber list, which must be each barber's own report and sum to it.
  it('holds for the shop: its day rows sum to its figures, and its barbers’ figures are their own reports’ and sum to its', async () => {
    const shop = await reportOf(ANALYTICS_FIXTURE_USERS.admin.id, null);
    expect(shop.reportSeatRows).toEqual([]);
    expectDayRowsAgree(shop);
    const reports = await barberReports();
    expect(shop.reportBarbers.map((entry) => entry.barberId).sort()).toEqual(
      [...BARBERS].sort(),
    );
    const sums = { takings: 0, tips: 0, noShows: 0, late: 0, rebooked: 0 };
    for (const entry of shop.reportBarbers) {
      const own = reports.get(entry.barberId) as AnalyticsReport;
      expect(entry, entry.barberId).toEqual({
        barberId: own.reportScopeBarberId,
        rosteredMinutes: own.reportRosteredMinutes,
        workedMinutes: own.reportWorkedMinutes,
        noShowMinutes: own.reportNoShowMinutes,
        unmarkedMinutes: own.reportUnmarkedMinutes,
        blockedMinutes: own.reportBlockedMinutes,
        unsoldMinutes: own.reportUnsoldMinutes,
        openMinutes: own.reportOpenMinutes,
        takingsCents: own.reportTakingsCents,
        tipsCents: own.reportTipsCents,
        rebookedCount: own.reportRebookedCount,
        rebookedBase: own.reportRebookedBase,
        rebookedRate: own.reportRebookedRate,
        noShowCount: own.reportNoShowCount,
        noShowBase: own.reportNoShowBase,
        noShowRate: own.reportNoShowRate,
        lateCancellationCount: own.reportLateCancellationCount,
      });
      sums.takings += entry.takingsCents;
      sums.tips += entry.tipsCents;
      sums.noShows += entry.noShowCount;
      sums.late += entry.lateCancellationCount;
      sums.rebooked += entry.rebookedCount;
    }
    expect(sums).toEqual({
      takings: shop.reportTakingsCents,
      tips: shop.reportTipsCents,
      noShows: shop.reportNoShowCount,
      late: shop.reportLateCancellationCount,
      rebooked: shop.reportRebookedCount,
    });
  });
});

/*
 * P1 — THE STORED DAYS SUM TO THE REPORT (staff analytics v2, PR 4a's
 * gate): `sum(pastDays.map(fold)) + sum(liveDays.map(fold))` is the
 * pipeline's report, figure by figure — minutes, money, counts, origins,
 * the service rows (minus the derived ratio), the hour grid and the day
 * rows — for the shop and for each barber, over the fixture month. The past
 * days are the day documents (`analyticsFixtureDayDocuments`), the live
 * days the 27th to the 30th folded at the pinned now.
 */
describe('P1 — sum(days.map(fold)) + live === report(visits), over the fixture month', () => {
  const documents = analyticsFixtureDayDocuments();
  const days = analyticsFixtureDays();
  const followUps = analyticsFixtureFollowUps();
  const policy = ClientStatsPolicy.forBooking(BookingPolicy.DEFAULT);

  it('stores the 1st to the 26th — 78 past barber-days, zeros included — and leaves the 27th to the 30th live', () => {
    expect(documents).toHaveLength(26 * 3);
    expect(documents.every((day) => day.localDate <= '2026-09-26')).toBe(true);
    expect(documents.every((day) => DayFigures.is(day))).toBe(true);
    expect(
      documents.every((day) => day.id === `${day.barberId}__${day.localDate}`),
    ).toBe(true);
    expect(
      days.filter((day) => !day.pastDay).map((day) => day.localDate),
    ).toEqual(
      expect.arrayContaining([
        '2026-09-27',
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
      ]),
    );
    expect(days.filter((day) => !day.pastDay)).toHaveLength(4 * 3);
  });

  async function expectP1(scopeBarberId: BarberId | null): Promise<void> {
    const caller =
      scopeBarberId === null
        ? ANALYTICS_FIXTURE_USERS.admin.id
        : USER_OF.get(scopeBarberId);
    if (caller === undefined)
      throw new Error(`no account for ${scopeBarberId}`);
    const report = await reportOf(caller, scopeBarberId);
    const inScope = (barberId: BarberId): boolean =>
      scopeBarberId === null || barberId === scopeBarberId;
    const live = days
      .filter((day) => !day.pastDay && inScope(day.barberId))
      .map((day) =>
        DayFiguresSystem.fold({
          day,
          visits: ANALYTICS_FIXTURE_VISITS,
          followUps,
          policy,
          computedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
      );
    const stored = documents.filter((day) => inScope(day.barberId));
    const total = DayFiguresSystem.sum(
      [...stored, ...live],
      ivan,
      ANALYTICS_FIXTURE_MONTH,
    );
    expect(
      {
        rostered: total.dayRosteredMinutes,
        worked: total.dayWorkedMinutes,
        noShow: total.dayNoShowMinutes,
        unmarked: total.dayUnmarkedMinutes,
        bookedAhead: total.dayBookedAheadMinutes,
        held: total.dayHeldMinutes,
        blocked: total.dayBlockedMinutes,
        breaks: total.dayBreakMinutes,
        shortGap: total.dayShortGapMinutes,
        unsold: total.dayUnsoldMinutes,
        open: total.dayOpenMinutes,
        closed: total.dayClosedDayMinutes,
        outside: total.dayOutsideHoursMinutes,
        outsideSeats: total.dayOutsideHoursSeatCount,
        takings: total.dayTakingsCents,
        tips: total.dayTipsCents,
        excluded: total.dayExcludedVisitCount,
        rebookedBase: total.dayRebookedBase,
        rebookedCount: total.dayRebookedCount,
        noShowCount: total.dayNoShowCount,
        noShowBase: total.dayNoShowBase,
        late: total.dayLateCancellationCount,
        origins: [
          {
            bookingOrigin: BookingOrigin.Online,
            visitCount: total.dayOnlineVisitCount,
          },
          {
            bookingOrigin: BookingOrigin.Staff,
            visitCount: total.dayStaffVisitCount,
          },
          {
            bookingOrigin: BookingOrigin.Unknown,
            visitCount: total.dayUnknownOriginVisitCount,
          },
        ],
        services: [...total.dayServices].sort((a, b) =>
          a.serviceId < b.serviceId ? -1 : 1,
        ),
      },
      String(scopeBarberId),
    ).toEqual({
      rostered: report.reportRosteredMinutes,
      worked: report.reportWorkedMinutes,
      noShow: report.reportNoShowMinutes,
      unmarked: report.reportUnmarkedMinutes,
      bookedAhead: report.reportBookedAheadMinutes,
      held: report.reportHeldMinutes,
      blocked: report.reportBlockedMinutes,
      breaks: report.reportBreakMinutes,
      shortGap: report.reportShortGapMinutes,
      unsold: report.reportUnsoldMinutes,
      open: report.reportOpenMinutes,
      closed: report.reportClosedDayMinutes,
      outside: report.reportOutsideHoursMinutes,
      outsideSeats: report.reportOutsideHoursSeatCount,
      takings: report.reportTakingsCents,
      tips: report.reportTipsCents,
      excluded: report.reportExcludedVisitCount,
      rebookedBase: report.reportRebookedBase,
      rebookedCount: report.reportRebookedCount,
      noShowCount: report.reportNoShowCount,
      noShowBase: report.reportNoShowBase,
      late: report.reportLateCancellationCount,
      origins: report.reportOrigins,
      services: report.reportServices
        .map(
          ({ serviceId, workedSeatCount, takingsCents, serviceMinutes }) => ({
            serviceId,
            workedSeatCount,
            takingsCents,
            serviceMinutes,
          }),
        )
        .sort((a, b) => (a.serviceId < b.serviceId ? -1 : 1)),
    });
    expect(
      AnalyticsHourSystem.grid(
        [...stored, ...live].map((day) => ({
          localDate: day.localDate,
          worked: day.dayHourWorked,
          rostered: day.dayHourRostered,
        })),
      ),
    ).toEqual(report.reportHourGrid);
    expect(report.reportDayRows).toEqual(
      [...stored, ...live]
        .map(DayFigures.rowOf)
        .sort(
          (a, b) =>
            (a.localDate < b.localDate
              ? -1
              : a.localDate > b.localDate
                ? 1
                : 0) ||
            (a.barberId < b.barberId ? -1 : a.barberId > b.barberId ? 1 : 0),
        ),
    );
    // The month is not empty: the property is not vacuous.
    expect(total.dayWorkedSeatCount).toBeGreaterThan(0);
  }

  it('holds for the shop', async () => {
    await expectP1(null);
  });

  it('holds for each barber', async () => {
    for (const barberId of BARBERS) await expectP1(barberId);
  });
});

/*
 * P2 — THE FLAG'S TWO SETTINGS AGREE (staff analytics v2, PR 4b's gate):
 * through `staffAnalytics(ports)` over the fixture month, a report read
 * with `analytics.storedDays` on — the 1st to the 26th from their day
 * documents, the 27th to the 30th live — equals the report read with it
 * off, every field but two: `reportComputedAtUtcMs` (the clock's, pinned
 * here anyway) and `reportMissingDays` (what the flag changes: 26 past
 * barber-days a scope computed live with it off, none with every document
 * present). `reportSeatRows` is the one list the stored path cannot fill
 * for a past day — its visits are not read — so it carries the live days'
 * rows only (the design's non-goal: seat rows are read live from visits).
 * A month with only half its documents agrees too: the missing half is
 * computed live from its visits and counted.
 */
describe('P2 — stored days + live days === every day live, through the pipeline', () => {
  const documents = analyticsFixtureDayDocuments();
  const STORED = [FlagName.AnalyticsStoredDays] as const;
  const FIRST_LIVE_DAY = localDate('2026-09-27');

  /** The fields the flag may change, and the seat rows (asserted apart). */
  const APART = new Set<keyof AnalyticsReport>([
    'reportComputedAtUtcMs',
    'reportMissingDays',
    'reportSeatRows',
  ]);

  /** The report without the fields asserted apart. */
  function comparable(report: AnalyticsReport): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(report).filter(
        ([field]) => !APART.has(field as keyof AnalyticsReport),
      ),
    );
  }

  async function expectP2(scopeBarberId: BarberId | null): Promise<void> {
    const caller =
      scopeBarberId === null
        ? ANALYTICS_FIXTURE_USERS.admin.id
        : USER_OF.get(scopeBarberId);
    if (caller === undefined)
      throw new Error(`no account for ${scopeBarberId}`);
    const barbers = scopeBarberId === null ? BARBERS.length : 1;
    const live = await reportOf(caller, scopeBarberId);
    const stored = await reportOf(caller, scopeBarberId, {
      storedDays: documents,
      flagsOn: STORED,
    });
    const half = await reportOf(caller, scopeBarberId, {
      storedDays: documents.filter((day) => day.localDate <= '2026-09-13'),
      flagsOn: STORED,
    });
    expect(comparable(stored), String(scopeBarberId)).toEqual(comparable(live));
    expect(comparable(half), String(scopeBarberId)).toEqual(comparable(live));
    expect(live.reportMissingDays).toBe(26 * barbers);
    expect(stored.reportMissingDays).toBe(0);
    expect(half.reportMissingDays).toBe(13 * barbers);
    // The seat rows: the live days' only once the past ones are stored.
    expect(stored.reportSeatRows).toEqual(
      live.reportSeatRows.filter((row) => row.localDate >= FIRST_LIVE_DAY),
    );
    expect(half.reportSeatRows).toEqual(
      live.reportSeatRows.filter((row) => row.localDate > '2026-09-13'),
    );
    // Not vacuous: the stored half holds money, and so do the live days.
    expect(stored.reportTakingsCents).toBeGreaterThan(0);
    expect(
      stored.reportDayRows.some(
        (row) => row.localDate <= '2026-09-26' && row.dayTakingsCents > 0,
      ),
    ).toBe(true);
  }

  it('holds for the shop', async () => {
    await expectP2(null);
  });

  it('holds for each barber', async () => {
    for (const barberId of BARBERS) await expectP2(barberId);
  });

  it('never reads a day document with the flag off, and reads the month’s and August’s in one range each with it on', async () => {
    const off = analyticsFixturePorts({ storedDays: documents });
    const on = analyticsFixturePorts({
      storedDays: documents,
      flagsOn: STORED,
    });
    const offDays = vi.fn(off.loadAnalyticsDays);
    const onDays = vi.fn(on.loadAnalyticsDays);
    unwrapOk(
      await staffAnalytics({ ...off, loadAnalyticsDays: offDays })({
        callerUserId: ANALYTICS_FIXTURE_USERS.admin.id,
        scopeBarberId: null,
        analyticsSpan: AnalyticsSpan.Month,
        fromLocalDate: ANALYTICS_FIXTURE_MONTH,
        toLocalDate: null,
        analyticsComparison: AnalyticsComparison.Previous,
      }),
    );
    unwrapOk(
      await staffAnalytics({ ...on, loadAnalyticsDays: onDays })({
        callerUserId: ANALYTICS_FIXTURE_USERS.admin.id,
        scopeBarberId: null,
        analyticsSpan: AnalyticsSpan.Month,
        fromLocalDate: ANALYTICS_FIXTURE_MONTH,
        toLocalDate: null,
        analyticsComparison: AnalyticsComparison.Previous,
      }),
    );
    expect(offDays).not.toHaveBeenCalled();
    expect(onDays.mock.calls.map(([, from, to]) => [from, to])).toEqual([
      ['2026-09-01', '2026-09-30'],
      ['2026-08-01', '2026-08-31'],
    ]);
  });
});
