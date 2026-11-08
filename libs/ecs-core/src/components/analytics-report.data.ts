import type {
  AppointmentId,
  AttendanceState,
  BarberId,
  HourOfDay,
  LocalDate,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SeatId,
  ServiceId,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import type { AnalyticsSpan } from './analytics-period.data';

/** The catalogue's version — raised whenever a formula changes, so cached reports are dropped. */
export const ANALYTICS_DEFINITION_VERSION = 1;

/** Where a visit was booked — the field `bookingOrigin`. */
export const BookingOrigin = {
  /** `placement: SELF` — the client booked online. */
  Online: 'ONLINE',
  /** `placement: STAFF` — the shop booked it. */
  Staff: 'STAFF',
  /** No recorded placement. */
  Unknown: 'UNKNOWN',
} as const;
export type BookingOrigin = (typeof BookingOrigin)[keyof typeof BookingOrigin];

/** Which figure a drill-down opens — the field `analyticsFigure`. */
export const AnalyticsFigure = {
  /** Worked seats with their nets. */
  Takings: 'TAKINGS',
  /** Worked seats with their tips. */
  Tips: 'TIPS',
  /** No-show seats. */
  NoShows: 'NO_SHOWS',
  /** Late client cancellations. */
  LateCancellations: 'LATE_CANCELLATIONS',
  /** Visits in the rebooking base, marked rebooked or not. */
  Rebooked: 'REBOOKED',
  /** The days, each with its time parts. */
  Time: 'TIME',
} as const;
export type AnalyticsFigure =
  (typeof AnalyticsFigure)[keyof typeof AnalyticsFigure];

/** One segment of the time bar — the field `analyticsBarPart`, in the bar's order. */
export const AnalyticsBarPart = {
  Worked: 'WORKED',
  NoShow: 'NO_SHOW',
  Unmarked: 'UNMARKED',
  Blocked: 'BLOCKED',
  Unsold: 'UNSOLD',
  /** Held time plus short gaps. */
  Other: 'OTHER',
} as const;
export type AnalyticsBarPart =
  (typeof AnalyticsBarPart)[keyof typeof AnalyticsBarPart];

/** Which way the hero's takings moved against the compared days of the previous period — the field `heroChange`. */
export const HeroChange = {
  /** No previous period to compare with. */
  None: 'NONE',
  Up: 'UP',
  Down: 'DOWN',
  /** The same takings. */
  Flat: 'FLAT',
} as const;
export type HeroChange = (typeof HeroChange)[keyof typeof HeroChange];

/**
 * A staff analytics report (`docs/designs/staff-analytics.md`, the metric
 * catalogue) — every value already decided, so a presenter only words it
 * (Law 10). Flat (Law 6): every 1-to-1 figure at the root under a `report`
 * prefix; the lists are the 1-to-N rows. Rates are `null` below their base
 * of 20; the `reportBar…` fields are the time bar's segments up to the
 * current minute.
 */
export type AnalyticsReport = {
  readonly reportDefinitionVersion: number;
  readonly reportComputedAtUtcMs: UtcEpochMs;
  /** The barber record reported on; `null` for the whole shop. */
  readonly reportScopeBarberId: BarberId | null;
  readonly reportAnalyticsSpan: AnalyticsSpan;
  readonly reportFromLocalDate: LocalDate;
  readonly reportToLocalDate: LocalDate;

  readonly reportRosteredMinutes: MinuteCount;
  readonly reportWorkedMinutes: MinuteCount;
  readonly reportNoShowMinutes: MinuteCount;
  readonly reportUnmarkedMinutes: MinuteCount;
  readonly reportBookedAheadMinutes: MinuteCount;
  readonly reportHeldMinutes: MinuteCount;
  readonly reportBlockedMinutes: MinuteCount;
  readonly reportBreakMinutes: MinuteCount;
  readonly reportShortGapMinutes: MinuteCount;
  readonly reportUnsoldMinutes: MinuteCount;
  readonly reportOpenMinutes: MinuteCount;
  readonly reportClosedDayMinutes: MinuteCount;
  readonly reportOutsideHoursMinutes: MinuteCount;
  readonly reportOutsideHoursSeatCount: number;

  readonly reportBarWorkedMinutes: MinuteCount;
  readonly reportBarNoShowMinutes: MinuteCount;
  readonly reportBarUnmarkedMinutes: MinuteCount;
  readonly reportBarBlockedMinutes: MinuteCount;
  readonly reportBarUnsoldMinutes: MinuteCount;
  /** Held time plus short gaps, up to now. */
  readonly reportBarOtherMinutes: MinuteCount;

  readonly reportTakingsCents: PriceCents;
  readonly reportTipsCents: PriceCents;
  /** Visits with worked seats whose bill could not be evaluated — left out of takings. */
  readonly reportExcludedVisitCount: number;
  /** Takings over the compared days of this period (the hero). */
  readonly reportHeroCurrentCents: PriceCents;
  /** Takings over the compared days of the previous period; `null` when there was none. */
  readonly reportHeroPreviousCents: PriceCents | null;

  readonly reportRebookedCount: number;
  readonly reportRebookedBase: number;
  readonly reportRebookedRate: number | null;
  readonly reportNoShowCount: number;
  readonly reportNoShowBase: number;
  readonly reportNoShowRate: number | null;
  readonly reportLateCancellationCount: number;

  readonly reportBookableOpenMinutes: MinuteCount;
  readonly reportEmptiestLocalDate: LocalDate | null;

  /**
   * The heatmap's busiest cell (`AnalyticsHourSystem.peak`): the weekday and
   * wall-clock hour with the highest `worked ÷ rostered` among the cells
   * with rostered minutes, the earliest (weekday, then hour) on a tie;
   * `null` under 7 rostered days in the period.
   */
  readonly reportBusiestWeekday: Weekday | null;
  readonly reportBusiestHour: HourOfDay | null;
  /** The emptiest cell — the lowest `worked ÷ rostered`, by the same rule and gate. */
  readonly reportEmptiestWeekday: Weekday | null;
  readonly reportEmptiestHour: HourOfDay | null;

  /**
   * The takings line's points, in order — one per day for a period of up to
   * 93 days, one per ISO week beyond (the first point's `localDate` is the
   * period's first day, every later one a Monday); their `takingsCents` sum
   * to `reportTakingsCents`.
   */
  readonly reportSeries: readonly AnalyticsReport.SeriesPoint[];
  /** The stacked time bars, at `reportSeries`' grain; each part sums to its `reportBar…` total. */
  readonly reportTimeSeries: readonly AnalyticsReport.TimePoint[];
  /** The heatmap: weekday × wall-clock hour over the period's days; only cells with minutes, so at most 168. */
  readonly reportHourGrid: readonly AnalyticsReport.HourCell[];
  /** The open-hours card's bars: today and the six days after it, their `openMinutes` summing to `reportBookableOpenMinutes`. */
  readonly reportAheadDays: readonly AnalyticsReport.AheadDay[];

  readonly reportServices: readonly AnalyticsReport.ServiceRow[];
  readonly reportWeekdayFill: readonly AnalyticsReport.WeekdayFill[];
  readonly reportOrigins: readonly AnalyticsReport.OriginShare[];
  /** One entry per barber record in a shop report; empty for one barber. */
  readonly reportBarbers: readonly AnalyticsReport.BarberFigures[];
  readonly reportDayRows: readonly AnalyticsReport.DayRow[];
  /** The scoped barber's seats; empty in a shop report. */
  readonly reportSeatRows: readonly AnalyticsReport.SeatRow[];
};

export namespace AnalyticsReport {
  /**
   * One point of the takings line: the bucket's first day, the net takings
   * of the worked seats in it (the `reportTakingsCents` rule, per bucket),
   * and the previous period's takings at the same position — `null` where
   * the previous period, at the same grain, has no bucket there.
   */
  export type SeriesPoint = {
    readonly localDate: LocalDate;
    readonly takingsCents: PriceCents;
    readonly comparisonTakingsCents: PriceCents | null;
  };

  /**
   * One stacked time bar: the bucket's first day and the six bar parts up to
   * the current minute — worked, no-show, unmarked, blocked (the past part),
   * unsold, and other (held time plus short gaps, the past parts).
   */
  export type TimePoint = {
    readonly localDate: LocalDate;
    readonly workedMinutes: MinuteCount;
    readonly noShowMinutes: MinuteCount;
    readonly unmarkedMinutes: MinuteCount;
    readonly blockedMinutes: MinuteCount;
    readonly unsoldMinutes: MinuteCount;
    readonly otherMinutes: MinuteCount;
  };

  /**
   * One heatmap cell: the minutes of worked and of rostered time
   * overlapping `[hour:00, hour+1:00)` on the wall clock, summed over the
   * period's days of that weekday. Worked, not occupied: a no-show hour is
   * not busy; worked time outside the rostered stretches is not counted.
   */
  export type HourCell = {
    readonly weekday: Weekday;
    readonly hour: HourOfDay;
    readonly workedMinutes: MinuteCount;
    readonly rosteredMinutes: MinuteCount;
  };

  /** One of the next seven shop days and its open (still bookable) minutes in scope. */
  export type AheadDay = {
    readonly localDate: LocalDate;
    readonly openMinutes: MinuteCount;
  };

  /** One service's worked seats. */
  export type ServiceRow = {
    readonly serviceId: ServiceId;
    readonly workedSeatCount: number;
    readonly takingsCents: PriceCents;
    /** Σ the seats' `durationMinutes` — the hour of service the next field divides by. */
    readonly serviceMinutes: MinuteCount;
    /** Takings per hour of service; `null` with no service minutes. */
    readonly takingsPerHourCents: PriceCents | null;
  };

  /** One weekday's fill over the period's past days (days before today). */
  export type WeekdayFill = {
    readonly weekday: Weekday;
    /** Worked + no-show + unmarked. */
    readonly filledMinutes: MinuteCount;
    /** Rostered − break. */
    readonly capacityMinutes: MinuteCount;
    /** `filled ÷ capacity`; `null` with no capacity. */
    readonly fillRate: number | null;
  };

  /** Visits with a worked seat in scope, by where they were booked. */
  export type OriginShare = {
    readonly bookingOrigin: BookingOrigin;
    readonly visitCount: number;
  };

  /** One barber's figures inside a shop report. */
  export type BarberFigures = {
    readonly barberId: BarberId;
    readonly rosteredMinutes: MinuteCount;
    readonly workedMinutes: MinuteCount;
    readonly noShowMinutes: MinuteCount;
    readonly unmarkedMinutes: MinuteCount;
    readonly blockedMinutes: MinuteCount;
    readonly unsoldMinutes: MinuteCount;
    readonly openMinutes: MinuteCount;
    readonly takingsCents: PriceCents;
    readonly tipsCents: PriceCents;
    readonly rebookedCount: number;
    readonly rebookedBase: number;
    readonly rebookedRate: number | null;
    readonly noShowCount: number;
    readonly noShowBase: number;
    readonly noShowRate: number | null;
    readonly lateCancellationCount: number;
  };

  /** One barber-day's parts (the `TIME` drill-down). */
  export type DayRow = {
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
    readonly rosteredMinutes: MinuteCount;
    readonly workedMinutes: MinuteCount;
    readonly noShowMinutes: MinuteCount;
    readonly unmarkedMinutes: MinuteCount;
    readonly bookedAheadMinutes: MinuteCount;
    readonly heldMinutes: MinuteCount;
    readonly blockedMinutes: MinuteCount;
    readonly breakMinutes: MinuteCount;
    readonly shortGapMinutes: MinuteCount;
    readonly unsoldMinutes: MinuteCount;
    readonly openMinutes: MinuteCount;
    readonly closedDayMinutes: MinuteCount;
  };

  /** One seat of the scoped barber (the money and count drill-downs). */
  export type SeatRow = {
    readonly appointmentId: AppointmentId;
    readonly seatId: SeatId;
    readonly localDate: LocalDate;
    readonly startMinutes: MinuteOfDay;
    readonly serviceId: ServiceId;
    readonly attendanceState: AttendanceState;
    /** The seat's net after its share of the bill's discounts; `0` unless worked. */
    readonly netCents: PriceCents;
    readonly tipCents: PriceCents;
    /** In the rebooking base and rebooked; `null` when the visit is not in the base. */
    readonly seatRebooked: boolean | null;
    readonly seatLateCancelled: boolean;
  };
}
