import {
  AppointmentId,
  AttendanceState,
  BarberId,
  HourOfDay,
  LocalDate,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  Result,
  SeatId,
  ServiceId,
  StoredFields,
  Tag,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import { AnalyticsSpan } from './analytics-period.data';
import { type AnalyticsReport, BookingOrigin } from './analytics-report.data';
import { CallAnswer } from './call-answer.data';

/**
 * What the `staffAnalytics` callable is asked for — flat (Law 6): the scope
 * and the period's first day and span. `scopeBarberId: null` is the shop for
 * an admin and the caller's own barber record for a barber; the period is
 * rebuilt with `AnalyticsPeriod.of`, which refuses a first day that is not a
 * Monday or a 1st.
 */
export type AnalyticsCall = {
  readonly scopeBarberId: BarberId | null;
  readonly fromLocalDate: LocalDate;
  readonly analyticsSpan: AnalyticsSpan;
};

/**
 * Reads one object's fields by name, each through its primitive's guard,
 * and remembers whether any failed — so a decoder reads every field once
 * and refuses the whole answer at the end. A failed field reads as its
 * fallback, which the caller never keeps: `ok()` is `false` then.
 */
type FieldReader = {
  readonly ok: () => boolean;
  readonly minutes: (name: string) => MinuteCount;
  readonly cents: (name: string) => PriceCents;
  readonly centsOrNull: (name: string) => PriceCents | null;
  readonly count: (name: string) => number;
  readonly rate: (name: string) => number | null;
  readonly flag: (name: string) => boolean;
  readonly flagOrNull: (name: string) => boolean | null;
  readonly localDate: (name: string) => LocalDate;
  readonly localDateOrNull: (name: string) => LocalDate | null;
  readonly weekdayOrNull: (name: string) => Weekday | null;
  readonly hourOrNull: (name: string) => HourOfDay | null;
  readonly list: (name: string) => readonly unknown[];
  readonly field: (name: string) => unknown;
};

/** The fallback of a refused date — never kept (the answer is refused). */
const NO_DATE = LocalDate.fromEpochDay(0);

function readerOf(source: unknown): FieldReader {
  const answer = CallAnswer.read(source);
  let ok = answer !== null;
  const field = (name: string): unknown =>
    answer === null ? undefined : StoredFields.field(answer, name);
  /** The field when the guard admits it, else the fallback and a failure. */
  function guarded<T, F>(
    name: string,
    is: (raw: unknown) => raw is T,
    fallback: F,
  ): T | F {
    const value = field(name);
    if (is(value)) return value;
    ok = false;
    return fallback;
  }
  function nullable<T>(
    name: string,
    is: (raw: unknown) => raw is T,
    fallback: T,
  ): T | null {
    const value = field(name);
    if (value === null) return null;
    return guarded(name, is, fallback);
  }
  const isCount = (raw: unknown): raw is number =>
    typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
  const isRate = (raw: unknown): raw is number =>
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1;
  const isFlag = (raw: unknown): raw is boolean => typeof raw === 'boolean';
  return {
    ok: () => ok,
    minutes: (name) => guarded(name, MinuteCount.is, MinuteCount.ZERO),
    cents: (name) => guarded(name, PriceCents.is, PriceCents.ZERO),
    centsOrNull: (name) => nullable(name, PriceCents.is, PriceCents.ZERO),
    count: (name) => guarded(name, isCount, 0),
    rate: (name) => nullable(name, isRate, 0),
    flag: (name) => guarded(name, isFlag, false),
    flagOrNull: (name) => nullable(name, isFlag, false),
    localDate: (name) => guarded(name, LocalDate.is, NO_DATE),
    localDateOrNull: (name) => nullable(name, LocalDate.is, NO_DATE),
    weekdayOrNull: (name) => nullable(name, Weekday.is, Weekday.Mon),
    hourOrNull: (name) => nullable(name, HourOfDay.is, HourOfDay.ALL[0]),
    list: (name) => {
      const value = field(name);
      if (Array.isArray(value)) return value;
      ok = false;
      return [];
    },
    field,
  };
}

/** Each entry of `raw` through `row`; `null` when any entry is unusable. */
function rowsOf<R>(
  raw: readonly unknown[],
  row: (entry: unknown) => R | null,
): readonly R[] | null {
  const out: R[] = [];
  for (let i = 0; i < raw.length; i++) {
    const decoded = row(raw[i]);
    if (decoded === null) return null;
    out.push(decoded);
  }
  return out;
}

function serviceRowOf(raw: unknown): AnalyticsReport.ServiceRow | null {
  const r = readerOf(raw);
  const serviceId = r.field('serviceId');
  const row = {
    workedSeatCount: r.count('workedSeatCount'),
    takingsCents: r.cents('takingsCents'),
    serviceMinutes: r.minutes('serviceMinutes'),
    takingsPerHourCents: r.centsOrNull('takingsPerHourCents'),
  };
  return r.ok() && ServiceId.is(serviceId) ? { serviceId, ...row } : null;
}

function weekdayFillOf(raw: unknown): AnalyticsReport.WeekdayFill | null {
  const r = readerOf(raw);
  const weekday = r.field('weekday');
  const row = {
    filledMinutes: r.minutes('filledMinutes'),
    capacityMinutes: r.minutes('capacityMinutes'),
    fillRate: r.rate('fillRate'),
  };
  return r.ok() && Weekday.is(weekday) ? { weekday, ...row } : null;
}

function originShareOf(raw: unknown): AnalyticsReport.OriginShare | null {
  const r = readerOf(raw);
  const bookingOrigin = r.field('bookingOrigin');
  const visitCount = r.count('visitCount');
  return r.ok() && Tag.has(BookingOrigin, bookingOrigin)
    ? { bookingOrigin, visitCount }
    : null;
}

function barberFiguresOf(raw: unknown): AnalyticsReport.BarberFigures | null {
  const r = readerOf(raw);
  const barberId = r.field('barberId');
  const row = {
    rosteredMinutes: r.minutes('rosteredMinutes'),
    workedMinutes: r.minutes('workedMinutes'),
    noShowMinutes: r.minutes('noShowMinutes'),
    unmarkedMinutes: r.minutes('unmarkedMinutes'),
    blockedMinutes: r.minutes('blockedMinutes'),
    unsoldMinutes: r.minutes('unsoldMinutes'),
    openMinutes: r.minutes('openMinutes'),
    takingsCents: r.cents('takingsCents'),
    tipsCents: r.cents('tipsCents'),
    rebookedCount: r.count('rebookedCount'),
    rebookedBase: r.count('rebookedBase'),
    rebookedRate: r.rate('rebookedRate'),
    noShowCount: r.count('noShowCount'),
    noShowBase: r.count('noShowBase'),
    noShowRate: r.rate('noShowRate'),
    lateCancellationCount: r.count('lateCancellationCount'),
  };
  return r.ok() && BarberId.is(barberId) ? { barberId, ...row } : null;
}

function dayRowOf(raw: unknown): AnalyticsReport.DayRow | null {
  const r = readerOf(raw);
  const barberId = r.field('barberId');
  const row = {
    localDate: r.localDate('localDate'),
    rosteredMinutes: r.minutes('rosteredMinutes'),
    workedMinutes: r.minutes('workedMinutes'),
    noShowMinutes: r.minutes('noShowMinutes'),
    unmarkedMinutes: r.minutes('unmarkedMinutes'),
    bookedAheadMinutes: r.minutes('bookedAheadMinutes'),
    heldMinutes: r.minutes('heldMinutes'),
    blockedMinutes: r.minutes('blockedMinutes'),
    breakMinutes: r.minutes('breakMinutes'),
    shortGapMinutes: r.minutes('shortGapMinutes'),
    unsoldMinutes: r.minutes('unsoldMinutes'),
    openMinutes: r.minutes('openMinutes'),
    closedDayMinutes: r.minutes('closedDayMinutes'),
  };
  return r.ok() && BarberId.is(barberId) ? { barberId, ...row } : null;
}

function seriesPointOf(raw: unknown): AnalyticsReport.SeriesPoint | null {
  const r = readerOf(raw);
  const row = {
    localDate: r.localDate('localDate'),
    takingsCents: r.cents('takingsCents'),
    comparisonTakingsCents: r.centsOrNull('comparisonTakingsCents'),
  };
  return r.ok() ? row : null;
}

function timePointOf(raw: unknown): AnalyticsReport.TimePoint | null {
  const r = readerOf(raw);
  const row = {
    localDate: r.localDate('localDate'),
    workedMinutes: r.minutes('workedMinutes'),
    noShowMinutes: r.minutes('noShowMinutes'),
    unmarkedMinutes: r.minutes('unmarkedMinutes'),
    blockedMinutes: r.minutes('blockedMinutes'),
    unsoldMinutes: r.minutes('unsoldMinutes'),
    otherMinutes: r.minutes('otherMinutes'),
  };
  return r.ok() ? row : null;
}

function hourCellOf(raw: unknown): AnalyticsReport.HourCell | null {
  const r = readerOf(raw);
  const weekday = r.field('weekday');
  const hour = r.field('hour');
  const row = {
    workedMinutes: r.minutes('workedMinutes'),
    rosteredMinutes: r.minutes('rosteredMinutes'),
  };
  return r.ok() && Weekday.is(weekday) && HourOfDay.is(hour)
    ? { weekday, hour, ...row }
    : null;
}

function aheadDayOf(raw: unknown): AnalyticsReport.AheadDay | null {
  const r = readerOf(raw);
  const row = {
    localDate: r.localDate('localDate'),
    openMinutes: r.minutes('openMinutes'),
  };
  return r.ok() ? row : null;
}

function seatRowOf(raw: unknown): AnalyticsReport.SeatRow | null {
  const r = readerOf(raw);
  const appointmentId = r.field('appointmentId');
  const seatId = r.field('seatId');
  const startMinutes = r.field('startMinutes');
  const serviceId = r.field('serviceId');
  const attendanceState = r.field('attendanceState');
  const rest = {
    localDate: r.localDate('localDate'),
    netCents: r.cents('netCents'),
    tipCents: r.cents('tipCents'),
    seatRebooked: r.flagOrNull('seatRebooked'),
    seatLateCancelled: r.flag('seatLateCancelled'),
  };
  return r.ok() &&
    AppointmentId.is(appointmentId) &&
    SeatId.is(seatId) &&
    MinuteOfDay.is(startMinutes) &&
    ServiceId.is(serviceId) &&
    Tag.has(AttendanceState, attendanceState)
    ? {
        appointmentId,
        seatId,
        startMinutes,
        serviceId,
        attendanceState,
        ...rest,
      }
    : null;
}

export const AnalyticsCall = {
  /**
   * `staffAnalytics`' answer — the report, every field read through its
   * primitive's guard (`CallAnswer`, Law 7.4) and every row list entry by
   * entry; anything missing or malformed is `PIPELINE_UNKNOWN`, the whole
   * answer refused. A list may be empty — a shop report's seat rows always
   * are, and so are a cached entry's (the cache keeps no seat rows). A
   * cached v1 entry without the chart lists (`reportSeries`, …) is refused
   * the same way: the catalogue version stays 1 until PR 4a, so the
   * decoder's refusal is what drops it.
   */
  decodeReport(raw: unknown): Result<AnalyticsReport, PipelineError> {
    const r = readerOf(raw);
    const version = r.field('reportDefinitionVersion');
    const computedAt = r.field('reportComputedAtUtcMs');
    const span = r.field('reportAnalyticsSpan');
    const scope = r.field('reportScopeBarberId');
    const figures = {
      reportFromLocalDate: r.localDate('reportFromLocalDate'),
      reportToLocalDate: r.localDate('reportToLocalDate'),

      reportRosteredMinutes: r.minutes('reportRosteredMinutes'),
      reportWorkedMinutes: r.minutes('reportWorkedMinutes'),
      reportNoShowMinutes: r.minutes('reportNoShowMinutes'),
      reportUnmarkedMinutes: r.minutes('reportUnmarkedMinutes'),
      reportBookedAheadMinutes: r.minutes('reportBookedAheadMinutes'),
      reportHeldMinutes: r.minutes('reportHeldMinutes'),
      reportBlockedMinutes: r.minutes('reportBlockedMinutes'),
      reportBreakMinutes: r.minutes('reportBreakMinutes'),
      reportShortGapMinutes: r.minutes('reportShortGapMinutes'),
      reportUnsoldMinutes: r.minutes('reportUnsoldMinutes'),
      reportOpenMinutes: r.minutes('reportOpenMinutes'),
      reportClosedDayMinutes: r.minutes('reportClosedDayMinutes'),
      reportOutsideHoursMinutes: r.minutes('reportOutsideHoursMinutes'),
      reportOutsideHoursSeatCount: r.count('reportOutsideHoursSeatCount'),

      reportBarWorkedMinutes: r.minutes('reportBarWorkedMinutes'),
      reportBarNoShowMinutes: r.minutes('reportBarNoShowMinutes'),
      reportBarUnmarkedMinutes: r.minutes('reportBarUnmarkedMinutes'),
      reportBarBlockedMinutes: r.minutes('reportBarBlockedMinutes'),
      reportBarUnsoldMinutes: r.minutes('reportBarUnsoldMinutes'),
      reportBarOtherMinutes: r.minutes('reportBarOtherMinutes'),

      reportTakingsCents: r.cents('reportTakingsCents'),
      reportTipsCents: r.cents('reportTipsCents'),
      reportExcludedVisitCount: r.count('reportExcludedVisitCount'),
      reportHeroCurrentCents: r.cents('reportHeroCurrentCents'),
      reportHeroPreviousCents: r.centsOrNull('reportHeroPreviousCents'),

      reportRebookedCount: r.count('reportRebookedCount'),
      reportRebookedBase: r.count('reportRebookedBase'),
      reportRebookedRate: r.rate('reportRebookedRate'),
      reportNoShowCount: r.count('reportNoShowCount'),
      reportNoShowBase: r.count('reportNoShowBase'),
      reportNoShowRate: r.rate('reportNoShowRate'),
      reportLateCancellationCount: r.count('reportLateCancellationCount'),

      reportBookableOpenMinutes: r.minutes('reportBookableOpenMinutes'),
      reportEmptiestLocalDate: r.localDateOrNull('reportEmptiestLocalDate'),

      reportBusiestWeekday: r.weekdayOrNull('reportBusiestWeekday'),
      reportBusiestHour: r.hourOrNull('reportBusiestHour'),
      reportEmptiestWeekday: r.weekdayOrNull('reportEmptiestWeekday'),
      reportEmptiestHour: r.hourOrNull('reportEmptiestHour'),
    };
    const series = rowsOf(r.list('reportSeries'), seriesPointOf);
    const timeSeries = rowsOf(r.list('reportTimeSeries'), timePointOf);
    const hourGrid = rowsOf(r.list('reportHourGrid'), hourCellOf);
    const aheadDays = rowsOf(r.list('reportAheadDays'), aheadDayOf);
    const services = rowsOf(r.list('reportServices'), serviceRowOf);
    const weekdayFill = rowsOf(r.list('reportWeekdayFill'), weekdayFillOf);
    const origins = rowsOf(r.list('reportOrigins'), originShareOf);
    const barbers = rowsOf(r.list('reportBarbers'), barberFiguresOf);
    const dayRows = rowsOf(r.list('reportDayRows'), dayRowOf);
    const seatRows = rowsOf(r.list('reportSeatRows'), seatRowOf);
    if (
      !r.ok() ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !UtcEpochMs.is(computedAt) ||
      !Tag.has(AnalyticsSpan, span) ||
      (scope !== null && !BarberId.is(scope)) ||
      series === null ||
      timeSeries === null ||
      hourGrid === null ||
      aheadDays === null ||
      services === null ||
      weekdayFill === null ||
      origins === null ||
      barbers === null ||
      dayRows === null ||
      seatRows === null
    ) {
      return CallAnswer.unusable();
    }
    return Result.ok({
      reportDefinitionVersion: version,
      reportComputedAtUtcMs: computedAt,
      reportScopeBarberId: scope,
      reportAnalyticsSpan: span,
      ...figures,
      reportSeries: series,
      reportTimeSeries: timeSeries,
      reportHourGrid: hourGrid,
      reportAheadDays: aheadDays,
      reportServices: services,
      reportWeekdayFill: weekdayFill,
      reportOrigins: origins,
      reportBarbers: barbers,
      reportDayRows: dayRows,
      reportSeatRows: seatRows,
    });
  },
} as const;
