import {
  AnalyticsSpan,
  ANALYTICS_DEFINITION_VERSION,
  type AnalyticsReport,
  BookingOrigin,
} from '@core/components';
import {
  AppointmentId,
  AttendanceState,
  BarberId,
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
