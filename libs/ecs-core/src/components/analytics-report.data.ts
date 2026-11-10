import type {
  AppointmentId,
  AttendanceState,
  BarberId,
  HourOfDay,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SeatId,
  ServiceId,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import type {
  AnalyticsComparison,
  AnalyticsSpan,
} from './analytics-period.data';
import type { DayRow } from './day-figures.data';

/**
 * The catalogue's version — raised whenever a formula changes, so cached
 * reports are dropped and every stored day (`dayDefinitionVersion`) becomes
 * eligible for the recompute. 2 since staff analytics v2 PR 4a: the day
 * rows are `DayRow`s (the `day*` fields, the money per day). 3 since the
 * location scope (ADR 2026-11-09): a stored day says which locations it
 * touched, with each one's share of a day split across shops.
 */
export const ANALYTICS_DEFINITION_VERSION = 3;

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

/** What the radars' normalised axes are drawn against — the field `reportRadarBase`. */
export const RadarBase = {
  /** Each axis `value ÷ best × 100`, the best among the shop's barbers meeting the floor. */
  BestOfShop: 'BEST_OF_SHOP',
  /** Fewer than two barbers in scope — nothing to compare against, no radar. */
  TooFewBarbers: 'TOO_FEW_BARBERS',
} as const;
export type RadarBase = (typeof RadarBase)[keyof typeof RadarBase];

/**
 * Where the month's takings stand against its goal — the field
 * `reportGoalPaceTag` (staff analytics v2 PR 6, `StaffAnalyticsSystem.goalPaceOf`):
 * `expectedLow/High = goalLow/High × daysWorkedSoFar ÷ daysRosteredInMonth`;
 * takings at or over the expected high are `AHEAD`, at or over the expected
 * low `ON_TRACK`, under it `BEHIND`.
 */
export const GoalPaceTag = {
  /** No goal, not a `MONTH`, or no rostered day worked yet. */
  None: 'NONE',
  Ahead: 'AHEAD',
  OnTrack: 'ON_TRACK',
  Behind: 'BEHIND',
} as const;
export type GoalPaceTag = (typeof GoalPaceTag)[keyof typeof GoalPaceTag];

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
  /**
   * The one barber record reported on — that barber's own report; `null`
   * for the whole team or a part of it (`reportScopeBarberIds`).
   */
  readonly reportScopeBarberId: BarberId | null;
  /** The barber records the scope names; none is the whole team (owner review 2026-11-09). */
  readonly reportScopeBarberIds: readonly BarberId[];
  /**
   * The locations reported on (ADR 2026-11-09; sets since 2026-11-09):
   * counted only for what happened there; none is every location.
   */
  readonly reportScopeLocationIds: readonly LocationId[];
  readonly reportAnalyticsSpan: AnalyticsSpan;
  readonly reportFromLocalDate: LocalDate;
  readonly reportToLocalDate: LocalDate;
  /** The comparison the call asked for — what the hero and the line compare with. */
  readonly reportAnalyticsComparison: AnalyticsComparison;
  /**
   * The comparison period's first and last day (`AnalyticsPeriod.previous`);
   * both `null` when the period is not comparable — its comparison would
   * start before the reach — and then `reportHeroPreviousCents` and every
   * `comparisonTakingsCents` are `null` too.
   */
  readonly reportComparisonFromLocalDate: LocalDate | null;
  readonly reportComparisonToLocalDate: LocalDate | null;
  /**
   * The period's PAST barber-days in scope computed live from their visits
   * because no day document of this definition existed for them — the flag
   * off, before the recompute's first pass, after a version bump (design,
   * The callable v2 contract). The screen says nothing; the log counts them.
   */
  readonly reportMissingDays: number;

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
  /** Takings over the compared days of the comparison period; `null` when there was none, or the period is not comparable. */
  readonly reportHeroPreviousCents: PriceCents | null;

  readonly reportRebookedCount: number;
  readonly reportRebookedBase: number;
  readonly reportRebookedRate: number | null;
  readonly reportNoShowCount: number;
  readonly reportNoShowBase: number;
  /**
   * The NEW clients: those whose first worked visit at the shop fell in the
   * period — with the scope's barber, or at the scope's location — read
   * off the client-stats projection (`StaffAnalyticsSystem.newClientCountOf`).
   */
  readonly reportNewClientCount: number;
  readonly reportNoShowRate: number | null;
  readonly reportLateCancellationCount: number;

  readonly reportBookableOpenMinutes: MinuteCount;
  /**
   * The working time still to come in the next seven days that the open
   * minutes are part of (owner, 2026-11-09: «97 ч free? shouldn't this be
   * only inside working hours and days?») — each `AheadDay.workingMinutes`
   * summed.
   */
  readonly reportBookableWorkingMinutes: MinuteCount;
  /** The barbers in scope with working time in the next seven days — whose hours the open-hours card adds up. */
  readonly reportAheadBarberCount: number;
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
   * The takings line's points, in order, at the span's grain
   * (`StaffAnalyticsSystem.seriesStartsOf`): one per day for a `DAY` (one
   * point), a `WEEK`, a `MONTH` or a `CUSTOM` range of up to 93 days; one
   * per ISO week for a longer `CUSTOM` range — a partial first week's
   * `localDate` is the period's first day, every later one that week's
   * Monday; one per month for a `YEAR` (the month's first day). Their
   * `takingsCents` sum to `reportTakingsCents`; the comparison is aligned
   * by position.
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
  /**
   * The comparison period's figures per barber record of a shop report, in
   * `reportBarbers`' order — the radars' grey outline; empty for one barber,
   * and when the period is not comparable. Its time parts and rebooking
   * pair come from the comparison period's stored days alone (the pipeline
   * reads no roster or follow-up for it); its money, seats and counts from
   * the stored days plus its live visits.
   */
  readonly reportComparisonBarbers: readonly AnalyticsReport.BarberFigures[];
  /**
   * How the shop's locations compete (owner review 2026-11-09): one row per
   * location of a shop report over two or more locations, in the shop's
   * location order — each one's figures as its own location report states
   * them (`AnalyticsCarouselSystem.locationFiguresOf`). Empty for a barber, for
   * one location's report, and for a shop with a single location.
   */
  readonly reportLocations: readonly AnalyticsReport.LocationFigures[];
  /**
   * The admin's radar (CUJ 5): one row per barber of a shop report on a
   * `MONTH`, `YEAR` or `CUSTOM` span, in `reportBarbers`' order
   * (`AnalyticsRadarSystem.radarsOf`); empty for one barber, on a `DAY` or
   * a `WEEK`, and with fewer than two barbers.
   */
  readonly reportRadars: readonly AnalyticsReport.RadarRow[];
  /** What `reportRadars` is normalised against; `TOO_FEW_BARBERS` whenever there are no rows. */
  readonly reportRadarBase: RadarBase;
  /**
   * The `TIME` drill-down's rows, date then barber: for a period of up to
   * 93 days one row per barber-day in scope — `DayFigures.rowOf` of the
   * stored day's body, or of the live day's fold; beyond that
   * (`StaffAnalyticsSystem.dayRowsAreMonths`: a `YEAR`, a longer `CUSTOM`
   * range) one row per barber-month, `DayFigures.sum` of that month's days
   * filed under the month's first day (a month in a `YEAR` opens the
   * `MONTH` span).
   */
  readonly reportDayRows: readonly DayRow[];
  /** The scoped barber's seats; empty in a shop report. */
  readonly reportSeatRows: readonly AnalyticsReport.SeatRow[];

  /**
   * The month's goal (PR 6, «Goals»): the scope's `analyticsGoals` range for
   * the period's month, read on a `MONTH` only — `null` off `MONTH` or
   * without a goal.
   */
  readonly reportGoalLowCents: PriceCents | null;
  readonly reportGoalHighCents: PriceCents | null;
  /** The pace against the goal (`StaffAnalyticsSystem.goalPaceOf`); `NONE` without one. */
  readonly reportGoalPaceTag: GoalPaceTag;
  /**
   * The formula's `daysWorkedSoFar`: the scope's days of the month with a
   * stretch up to and including today — on the shop scope a day counts once
   * when any barber has a stretch; `0` off `MONTH`.
   */
  readonly reportGoalDaysSoFar: number;
  /** The formula's `daysRosteredInMonth`: the month's days with a stretch, by the same rule; `0` off `MONTH`. */
  readonly reportGoalDaysInMonth: number;
};

export namespace AnalyticsReport {
  /**
   * One point of the takings line: the bucket's first day, the net takings
   * of the worked seats in it (the `reportTakingsCents` rule, per bucket),
   * and the comparison period's takings at the same position — `null` where
   * the comparison period, at the same grain, has no bucket there, and at
   * every position when the period is not comparable. A `DAY` has one point.
   */
  export type SeriesPoint = {
    readonly localDate: LocalDate;
    readonly takingsCents: PriceCents;
    /**
     * The bucket's tips, summed exactly as its takings are — so the tips
     * line has a point wherever the takings line does, at any range (a
     * range's day rows may be per month; the series never is coarser
     * than its buckets).
     */
    readonly tipsCents: PriceCents;
    /**
     * The bucket's takings by service, summed as its takings are (a stored
     * day's service rows, a live visit's worked seats) — each service once,
     * by id, only the ones that took something; together they make
     * `takingsCents`. The takings bars stack them, each in its colour
     * (owner, 2026-11-09).
     */
    readonly serviceTakings: readonly AnalyticsReport.ServiceTakings[];
    readonly comparisonTakingsCents: PriceCents | null;
  };

  /** One service's takings in a bucket of the series. */
  export type ServiceTakings = {
    readonly serviceId: ServiceId;
    readonly takingsCents: PriceCents;
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

  /**
   * One of the next seven shop days in scope: its open (still bookable)
   * minutes, and the working time still to come they are part of — the
   * roster's windows from now on, breaks, blocks and days off out.
   */
  export type AheadDay = {
    readonly localDate: LocalDate;
    readonly openMinutes: MinuteCount;
    readonly workingMinutes: MinuteCount;
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
    /** Σ the worked seats' `durationMinutes` — as `ServiceRow.serviceMinutes` sums them; the hour of service the radar divides by. */
    readonly serviceMinutes: MinuteCount;
    /** The worked seats, whether or not their bill could be evaluated — the € per hour and tips rate floors' base. */
    readonly workedSeatCount: number;
    /** The distinct shop days of the period that roster any minute for the barber — the fill floor's base. */
    readonly rosteredDayCount: number;
  };

  /**
   * One location's figures inside a shop report — what its own location
   * report says: the takings and their pace against the comparison (the
   * hero pair), the worked time and its occupancy, the clients served and
   * new, the two rates, and its takings per bucket of `reportSeries`, in
   * the same order.
   */
  export type LocationFigures = {
    readonly locationId: LocationId;
    readonly takingsCents: PriceCents;
    readonly tipsCents: PriceCents;
    readonly heroCurrentCents: PriceCents;
    readonly heroPreviousCents: PriceCents | null;
    readonly workedMinutes: MinuteCount;
    /** Worked of the rostered time so far, `0 … 1`; `null` with nothing rostered. */
    readonly occupancy: number | null;
    /** Worked seats — the no-show base less the no-shows. */
    readonly servedCount: number;
    readonly newClientCount: number;
    readonly rebookedRate: number | null;
    readonly noShowRate: number | null;
    /** Its takings per bucket of the shop's `reportSeries`, aligned by position. */
    readonly seriesCents: readonly PriceCents[];
  };

  /**
   * One barber's radar: the four axes normalised 0–100 against the shop's
   * best barber meeting the floor — € per hour of service, fill, rebooking,
   * tips rate — and reliability absolute (`(1 − noShowRate) × 100`); then
   * the comparison period's five, on the SAME best (so a comparison axis may
   * exceed 100). `null` is an axis under its floor, with no best, or — the
   * comparison's — a barber with no comparison figures; the screen draws it
   * as missing with a word.
   */
  export type RadarRow = {
    readonly barberId: BarberId;
    readonly takingsPerHour: number | null;
    readonly fill: number | null;
    readonly rebooking: number | null;
    readonly tipsRate: number | null;
    readonly reliability: number | null;
    readonly comparisonTakingsPerHour: number | null;
    readonly comparisonFill: number | null;
    readonly comparisonRebooking: number | null;
    readonly comparisonTipsRate: number | null;
    readonly comparisonReliability: number | null;
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
