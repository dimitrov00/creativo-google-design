import { describe, expect, it } from 'vitest';
import {
  AnalyticsComparison,
  AnalyticsFigure,
  AnalyticsSpan,
  type AnalyticsReport,
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
  ChairTimeSystem,
  ClientStatsSystem,
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

async function reportOf(
  callerUserId: UserId,
  scopeBarberId: BarberId | null,
): Promise<AnalyticsReport> {
  return unwrapOk(
    await staffAnalytics(analyticsFixturePorts())({
      callerUserId,
      scopeBarberId,
      analyticsSpan: AnalyticsSpan.Month,
      fromLocalDate: ANALYTICS_FIXTURE_MONTH,
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
          free: row.unsoldMinutes + row.openMinutes,
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
        expect(day?.unsoldMinutes).toBe(row.unsoldMinutes);
        expect(day?.openMinutes).toBe(row.openMinutes);
        expect(day === undefined ? -1 : ChairTimeSystem.partsTotal(day)).toBe(
          row.rosteredMinutes,
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
    expect(row(ivan, '2026-09-18')?.blockedMinutes).toBe(120);
    // Monday the 14th: the beard over the 13:00 break is worked, the break gone.
    expect(row(ivan, '2026-09-14')?.breakMinutes).toBe(0);
    expect(row(ivan, '2026-09-14')?.workedMinutes).toBe(60);
    // Niko's closed Friday rosters nothing and keeps what it would have.
    expect(row(niko, '2026-09-04')?.rosteredMinutes).toBe(0);
    expect(row(niko, '2026-09-04')?.closedDayMinutes).toBe(540);
    // Maria's Saturday at the hidden shop: no rostered time, nothing free.
    expect(row(maria, '2026-09-19')?.rosteredMinutes).toBe(0);
    expect(scheduleFreeMinutes(maria, localDate('2026-09-19'))).toBe(0);
    // Today is cut at 09:00: Ivan's free time ahead of now is open.
    expect(row(ivan, '2026-09-28')?.openMinutes).toBeGreaterThan(0);
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
    const sum = (part: keyof AnalyticsReport.DayRow): number =>
      days.reduce((total, day) => total + (day[part] as number), 0);
    expect({
      rostered: sum('rosteredMinutes'),
      worked: sum('workedMinutes'),
      noShow: sum('noShowMinutes'),
      unmarked: sum('unmarkedMinutes'),
      bookedAhead: sum('bookedAheadMinutes'),
      held: sum('heldMinutes'),
      blocked: sum('blockedMinutes'),
      breaks: sum('breakMinutes'),
      shortGap: sum('shortGapMinutes'),
      unsold: sum('unsoldMinutes'),
      open: sum('openMinutes'),
      closed: sum('closedDayMinutes'),
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
