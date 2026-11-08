import {
  AnalyticsComparison,
  AnalyticsSpan,
  ANALYTICS_DEFINITION_VERSION,
  type AnalyticsReport,
  BookingOrigin,
} from '@core/components';
import {
  AppointmentId,
  AttendanceState,
  BarberId,
  type HourOfDay,
  LocalDate,
  MinuteCount,
  type PriceCents,
  Result,
  SeatId,
  ServiceId,
  Weekday,
} from '@core/primitives';
import type { AnalyticsCacheKey, AnalyticsCachePorts } from '@core/ports';
import { FIXTURE_NOW_UTC_MS, localDate, minute } from './test-support';

/*
 * A STAFF ANALYTICS REPORT, hand-built — the screen's specs word it, cache
 * it and drill into it with every figure known in advance. September 2026
 * (the month of `FIXTURE_TODAY`, 2026-09-28) for the barber `ivan`; the
 * figures agree with the rows: two worked seats (28,00 € + 17,50 € =
 * 45,50 €, tips 5,00 €), one no-show, one late cancellation, two day rows.
 * `shopReportFixture` is the same month for the shop, its barbers listed and
 * no seat rows.
 */

const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const cut = ServiceId.of('haircut');
const beard = ServiceId.of('beard');

const m = (raw: number): MinuteCount => raw as MinuteCount;
const cents = (raw: number): PriceCents => raw as PriceCents;

/** September 2026, day by day (the MONTH span's grain). */
const SEPTEMBER_DAYS = LocalDate.range(
  localDate('2026-09-01'),
  localDate('2026-09-30'),
);

/**
 * The takings line: 28,00 € on the 14th and 17,50 € on the 15th (the two
 * worked seats), nothing else; August's takings at the same position — the
 * hero's 35,00 € on the 14th's counterpart — so the points sum to the
 * report's takings and the comparison line has a value at every position
 * (August is the longer month).
 */
function seriesPoints(): readonly AnalyticsReport.SeriesPoint[] {
  return SEPTEMBER_DAYS.map((day, index) => ({
    localDate: day,
    takingsCents: cents(
      day === '2026-09-14' ? 2800 : day === '2026-09-15' ? 1750 : 0,
    ),
    comparisonTakingsCents: cents(index === 13 ? 3500 : 0),
  }));
}

/**
 * The time bars, day by day: the two worked days carry the bar's parts
 * (worked 270 + 210, no-show 30 + 30, blocked 60 + 60, unsold 100 + 100,
 * other 10 + 10 — the report's `reportBar…` totals), every other day is
 * empty.
 */
function timePoints(): readonly AnalyticsReport.TimePoint[] {
  return SEPTEMBER_DAYS.map((day) => {
    const worked = day === '2026-09-14' ? 270 : day === '2026-09-15' ? 210 : 0;
    const on = worked > 0;
    return {
      localDate: day,
      workedMinutes: m(worked),
      noShowMinutes: m(on ? 30 : 0),
      unmarkedMinutes: m(0),
      blockedMinutes: m(on ? 60 : 0),
      unsoldMinutes: m(on ? 100 : 0),
      otherMinutes: m(on ? 10 : 0),
    };
  });
}

/**
 * The heatmap: the two rostered days, 09:00–18:00 each (9 cells of 60
 * rostered minutes — 1080 in all, the report's rostered time); Monday's
 * 270 worked minutes as 30 per hour, Tuesday's 210 as 30 per hour from 9 to
 * 15 — 480 in all, the report's worked time. Two rostered days: under the
 * base of 7, so the report names no busiest or emptiest hour.
 */
function hourCells(): readonly AnalyticsReport.HourCell[] {
  const cells: AnalyticsReport.HourCell[] = [];
  for (const [weekday, workedUntil] of [
    [Weekday.Mon, 18],
    [Weekday.Tue, 16],
  ] as const) {
    for (let hour = 9; hour < 18; hour++) {
      cells.push({
        weekday,
        hour: hour as HourOfDay,
        workedMinutes: m(hour < workedUntil ? 30 : 0),
        rosteredMinutes: m(60),
      });
    }
  }
  return cells;
}

/** The seven days from `FIXTURE_TODAY` (28 September): 390 open minutes, the most on the 29th. */
function aheadDays(): readonly AnalyticsReport.AheadDay[] {
  const open = [0, 120, 90, 60, 60, 30, 30];
  return open.map((minutes, index) => ({
    localDate: LocalDate.addDays(localDate('2026-09-28'), index),
    openMinutes: m(minutes),
  }));
}

function dayRow(
  barberId: BarberId,
  day: string,
  worked: number,
): AnalyticsReport.DayRow {
  return {
    barberId,
    localDate: localDate(day),
    rosteredMinutes: m(540),
    workedMinutes: m(worked),
    noShowMinutes: m(30),
    unmarkedMinutes: m(0),
    bookedAheadMinutes: m(0),
    heldMinutes: m(0),
    blockedMinutes: m(60),
    breakMinutes: m(30),
    shortGapMinutes: m(10),
    unsoldMinutes: m(540 - worked - 30 - 60 - 30 - 10),
    openMinutes: m(0),
    closedDayMinutes: m(0),
  };
}

function seatRow(
  id: string,
  day: string,
  start: number,
  serviceId: ServiceId,
  attendanceState: AttendanceState,
  net: number,
  tip: number,
  rest: Partial<AnalyticsReport.SeatRow> = {},
): AnalyticsReport.SeatRow {
  return {
    appointmentId: AppointmentId.of(`a-${id}`),
    seatId: SeatId.of(`s-${id}`),
    localDate: localDate(day),
    startMinutes: minute(start),
    serviceId,
    attendanceState,
    netCents: cents(net),
    tipCents: cents(tip),
    seatRebooked: null,
    seatLateCancelled: false,
    ...rest,
  };
}

/** Ivan's September 2026 — every field set, the figures equal to their rows. */
export function analyticsReportFixture(
  overrides: Partial<AnalyticsReport> = {},
): AnalyticsReport {
  return {
    reportDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
    reportComputedAtUtcMs: FIXTURE_NOW_UTC_MS,
    reportScopeBarberId: ivan,
    reportAnalyticsSpan: AnalyticsSpan.Month,
    reportFromLocalDate: localDate('2026-09-01'),
    reportToLocalDate: localDate('2026-09-30'),
    reportAnalyticsComparison: AnalyticsComparison.Previous,
    reportComparisonFromLocalDate: localDate('2026-08-01'),
    reportComparisonToLocalDate: localDate('2026-08-31'),

    reportRosteredMinutes: m(1080),
    reportWorkedMinutes: m(480),
    reportNoShowMinutes: m(60),
    reportUnmarkedMinutes: m(0),
    reportBookedAheadMinutes: m(90),
    reportHeldMinutes: m(0),
    reportBlockedMinutes: m(120),
    reportBreakMinutes: m(60),
    reportShortGapMinutes: m(20),
    reportUnsoldMinutes: m(200),
    reportOpenMinutes: m(50),
    reportClosedDayMinutes: m(0),
    reportOutsideHoursMinutes: m(0),
    reportOutsideHoursSeatCount: 0,

    reportBarWorkedMinutes: m(480),
    reportBarNoShowMinutes: m(60),
    reportBarUnmarkedMinutes: m(0),
    reportBarBlockedMinutes: m(120),
    reportBarUnsoldMinutes: m(200),
    reportBarOtherMinutes: m(20),

    reportTakingsCents: cents(4550),
    reportTipsCents: cents(500),
    reportExcludedVisitCount: 0,
    reportHeroCurrentCents: cents(4550),
    reportHeroPreviousCents: cents(3500),

    reportRebookedCount: 1,
    reportRebookedBase: 2,
    reportRebookedRate: null,
    reportNoShowCount: 1,
    reportNoShowBase: 3,
    reportNoShowRate: null,
    reportLateCancellationCount: 1,

    reportBookableOpenMinutes: m(390),
    reportEmptiestLocalDate: localDate('2026-09-29'),

    reportBusiestWeekday: null,
    reportBusiestHour: null,
    reportEmptiestWeekday: null,
    reportEmptiestHour: null,

    reportSeries: seriesPoints(),
    reportTimeSeries: timePoints(),
    reportHourGrid: hourCells(),
    reportAheadDays: aheadDays(),

    reportServices: [
      {
        serviceId: cut,
        workedSeatCount: 1,
        takingsCents: cents(2800),
        serviceMinutes: m(40),
        takingsPerHourCents: cents(4200),
      },
      {
        serviceId: beard,
        workedSeatCount: 1,
        takingsCents: cents(1750),
        serviceMinutes: m(30),
        takingsPerHourCents: cents(3500),
      },
    ],
    reportWeekdayFill: [
      {
        weekday: Weekday.Mon,
        filledMinutes: m(270),
        capacityMinutes: m(450),
        fillRate: 0.6,
      },
    ],
    reportOrigins: [
      { bookingOrigin: BookingOrigin.Online, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Staff, visitCount: 1 },
      { bookingOrigin: BookingOrigin.Unknown, visitCount: 0 },
    ],
    reportBarbers: [],
    reportDayRows: [
      dayRow(ivan, '2026-09-14', 270),
      dayRow(ivan, '2026-09-15', 210),
    ],
    reportSeatRows: [
      seatRow('1', '2026-09-14', 600, cut, AttendanceState.Worked, 2800, 300, {
        seatRebooked: true,
      }),
      seatRow(
        '2',
        '2026-09-15',
        660,
        beard,
        AttendanceState.Worked,
        1750,
        200,
        {
          seatRebooked: false,
        },
      ),
      seatRow('3', '2026-09-15', 720, cut, AttendanceState.NoShow, 0, 0),
      seatRow('4', '2026-09-16', 600, cut, AttendanceState.Cancelled, 0, 0, {
        seatLateCancelled: true,
      }),
    ],
    ...overrides,
  };
}

/** The shop's September 2026: two barbers, their sums the shop's, no seat rows. */
export function shopReportFixture(
  overrides: Partial<AnalyticsReport> = {},
): AnalyticsReport {
  const barber = (
    barberId: BarberId,
    takings: number,
  ): AnalyticsReport.BarberFigures => ({
    barberId,
    rosteredMinutes: m(540),
    workedMinutes: m(240),
    noShowMinutes: m(30),
    unmarkedMinutes: m(0),
    blockedMinutes: m(60),
    unsoldMinutes: m(100),
    openMinutes: m(25),
    takingsCents: cents(takings),
    tipsCents: cents(250),
    rebookedCount: 1,
    rebookedBase: 1,
    rebookedRate: null,
    noShowCount: 0,
    noShowBase: 1,
    noShowRate: null,
    lateCancellationCount: 0,
  });
  return analyticsReportFixture({
    reportScopeBarberId: null,
    reportBarbers: [barber(ivan, 2800), barber(niko, 1750)],
    reportDayRows: [
      dayRow(ivan, '2026-09-14', 270),
      dayRow(niko, '2026-09-14', 210),
    ],
    reportSeatRows: [],
    ...overrides,
  });
}

/** What `memoryAnalyticsCachePorts` holds: the entries by key, and every call it took. */
export type AnalyticsCacheState = {
  readonly entries: Map<string, AnalyticsReport>;
  readonly writes: { key: AnalyticsCacheKey; report: AnalyticsReport }[];
  clears: number;
};

/** One key's spelling inside the double — its fields joined; the adapter's own encoding is its spec's. */
export function analyticsCacheKeyOf(key: AnalyticsCacheKey): string {
  return [
    key.userId,
    key.scopeBarberId ?? '',
    key.analyticsSpan,
    key.fromLocalDate,
    key.analyticsComparison,
  ].join('|');
}

/**
 * The device cache in memory — the store specs' double: an entry kept as
 * written, seat rows dropped like the adapter drops them; a clear empties it.
 */
export function memoryAnalyticsCachePorts(
  seed: readonly (readonly [AnalyticsCacheKey, AnalyticsReport])[] = [],
): AnalyticsCachePorts & { readonly state: AnalyticsCacheState } {
  const state: AnalyticsCacheState = {
    entries: new Map(
      seed.map(([key, report]) => [analyticsCacheKeyOf(key), report]),
    ),
    writes: [],
    clears: 0,
  };
  return {
    state,
    readCachedReport: (key) =>
      Result.ok(state.entries.get(analyticsCacheKeyOf(key)) ?? null),
    writeCachedReport: (key, report) => {
      state.writes.push({ key, report });
      state.entries.set(analyticsCacheKeyOf(key), {
        ...report,
        reportSeatRows: [],
      });
      return Result.ok(undefined);
    },
    clearCachedReports: () => {
      state.clears++;
      state.entries.clear();
      return Result.ok(undefined);
    },
  };
}
