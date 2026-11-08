import {
  AttendanceState,
  BookingStatus,
  BusyKey,
  ExceptionEffect,
  LocalDate,
  MinuteCount,
  PriceCents,
  Result,
  type AppointmentId,
  type BarberId,
  type LocationId,
  type ServiceId,
  type TimeZone,
  type UtcEpochMs,
  type Weekday,
} from '@core/primitives';
import { AnalyticsError } from '@core/errors';
import {
  ANALYTICS_DEFINITION_VERSION,
  AccountLifecycle,
  AnalyticsBarPart,
  type AnalyticsComparison,
  AnalyticsFigure,
  AnalyticsPeriod,
  AnalyticsSpan,
  HeroChange,
  type AnalyticsCall,
  type AnalyticsReport,
  BookingOrigin,
  ClientStatsPolicy,
  type MinuteRange,
  Placement,
  type Role,
  Roles,
  Seat,
  type ShopNow,
  StaffLink,
} from '@core/components';
import type {
  Appointment,
  BarberSchedule,
  ScheduleException,
  ShopLocation,
  User,
} from '@core/entities';
import { AnalyticsHourSystem, type HourDay } from './analytics-hour.system';
import {
  type ChairDay,
  type ChairVisit,
  ChairTimeSystem,
} from './chair-time.system';
import { ClientStatsSystem } from './client-stats.system';
import { IntervalSetSystem } from './interval-set.system';
import {
  MoneyAllocation,
  MoneyAllocationSystem,
  type SeatNet,
} from './money-allocation.system';
import { PartyAdmissionSystem } from './party-admission.system';
import { type BuildDayWindowsInput, RosterSystem } from './roster.system';
import { ZonedTimeSystem } from './zoned-time.system';

/** The caller as the visibility table judges them — from their STORED user record. */
export type AnalyticsCaller = {
  readonly callerRoles: readonly Role[];
  /** Blocked (or erased) at the call's instant. */
  readonly callerBlocked: boolean;
  readonly linkedBarberId: BarberId | null;
};

/** A visit as the report reads it — an `Appointment` satisfies it as is. */
export type AnalyticsVisit = Pick<
  Appointment,
  | 'id'
  | 'localDate'
  | 'startMinutes'
  | 'utcEpochMs'
  | 'bookingStatus'
  | 'placement'
  | 'bookedAtUtcMs'
  | 'seats'
  | 'discounts'
>;

/** A visit booked from an earlier one, with the shop day it was booked on (converted once, at the pipeline's boundary). */
export type AnalyticsFollowUp = {
  readonly bookedFromAppointmentId: AppointmentId;
  readonly bookedOnLocalDate: LocalDate;
  /** The follow-up is cancelled now. */
  readonly followUpCancelled: boolean;
};

/**
 * A barber-day's parts, with the minutes a `CLOSED` day would have rostered
 * and the day's offered stretches — the rostered ranges on the wall clock
 * (the roster's offered windows, blocks and breaks at the ACTIVE shops,
 * normalized: what `rosteredMinutes` totals), which the hour grid buckets.
 */
export type AnalyticsDay = ChairDay & {
  readonly closedDayMinutes: MinuteCount;
  readonly stretches: readonly MinuteRange[];
};

/** Everything a report is computed from — read by the pipeline, nothing else. */
export type AnalyticsInput = {
  /** The barber record reported on; `null` for the shop. */
  readonly scopeBarberId: BarberId | null;
  /** The barber records in scope: the one, or every one of the shop. */
  readonly barberIds: readonly BarberId[];
  readonly period: AnalyticsPeriod;
  /** The comparison the call asked for — stated on the report as it is. */
  readonly analyticsComparison: AnalyticsComparison;
  /** The scope's barber-days of the period. */
  readonly days: readonly AnalyticsDay[];
  /** The scope's barber-days of the next 7 shop days from today. */
  readonly aheadDays: readonly ChairDay[];
  /** The period's visits with a seat in scope, each once. */
  readonly visits: readonly AnalyticsVisit[];
  /**
   * The comparison period's visits with a seat in scope — the hero's and
   * the line's comparison; empty (never read) when the period is not
   * comparable (`AnalyticsPeriod.isComparable`).
   */
  readonly previousVisits: readonly AnalyticsVisit[];
  readonly followUps: readonly AnalyticsFollowUp[];
  readonly policy: ClientStatsPolicy;
  readonly now: ShopNow;
};

/** A visit as a follow-up read answers it — an `Appointment` satisfies it as is. */
export type FollowUpVisit = Pick<
  Appointment,
  | 'id'
  | 'locationId'
  | 'bookingStatus'
  | 'bookedAtUtcMs'
  | 'bookedFromAppointmentId'
>;

/** A follow-up the rebooking rule can judge: booked from a visit, at a known instant. */
export type CountedFollowUp = FollowUpVisit & {
  readonly bookedFromAppointmentId: AppointmentId;
  readonly bookedAtUtcMs: UtcEpochMs;
};

/** One shop's clock at the call's instant — derived once per location at the pipeline's boundary. */
export type ShopNowAt = ShopNow & {
  readonly locationId: LocationId;
};

/**
 * Everything a scope's barber-days are built from: the days, the rosters
 * and departures as stored, every shop (the ACTIVE ones bound rostered time,
 * as the schedule does), the visits of those days, and the clocks — each
 * shop's, and the report's own for a day worked at no known shop.
 */
export type AnalyticsDaysInput = {
  readonly barberIds: readonly BarberId[];
  readonly localDates: readonly LocalDate[];
  readonly rosters: readonly BarberSchedule[];
  readonly departures: readonly ScheduleException[];
  readonly locations: readonly ShopLocation[];
  readonly visits: readonly AnalyticsVisit[];
  readonly nowByLocation: readonly ShopNowAt[];
  readonly now: ShopNow;
};

/** What a drill-down narrows its rows by; `null` narrows nothing. */
export type AnalyticsRowFilter = {
  readonly serviceId: ServiceId | null;
  readonly localDate: LocalDate | null;
};

/** The hero's comparison: which way, and by how much when there is a base to divide by. */
export type AnalyticsHeroChange = {
  readonly heroChange: HeroChange;
  /** `(current − previous) ÷ previous`; `null` with no previous period or a previous of 0. */
  readonly heroChangeRate: number | null;
};

/** One segment of the time bar: its minutes and its share of the bar. */
export type AnalyticsBarSegment = {
  readonly analyticsBarPart: AnalyticsBarPart;
  readonly minutes: MinuteCount;
  /** `minutes ÷` the bar's whole; `0` for an empty bar. */
  readonly share: number;
};

/** What the screen shows of a report — every "which sections" answer, decided here. */
export type AnalyticsScreen = {
  /** A shop report: fill by weekday, booking origins, and per-barber drill-downs. */
  readonly shopScope: boolean;
  /** A barber report: its figures open to their seats. */
  readonly drillsToSeats: boolean;
  /** Nothing booked, worked or cancelled in the period — the empty state. */
  readonly periodEmpty: boolean;
  /** The period holds rostered time — the empty state names it. */
  readonly rostered: boolean;
  /** A count rate sits under its base of 20, so it shows as "n of m" (design G6). */
  readonly smallSample: boolean;
  /** The open-hours card leads to a day in the schedule. */
  readonly opensEmptiestDay: boolean;
  /** The hero leaves some visits out (their bill could not be evaluated). */
  readonly excludesVisits: boolean;
};

/** The periods either side of one, `null` where the screen may not go (design: 12 months back, never past today). */
export type AnalyticsSteps = {
  readonly previous: AnalyticsPeriod | null;
  readonly next: AnalyticsPeriod | null;
};

/** One choice of the admin's scope picker: the shop (`null`) or a barber record, and whether it is the admin's own. */
export type AnalyticsScopeChoice = {
  readonly scopeBarberId: BarberId | null;
  readonly scopeMine: boolean;
};

/** What a drill-down's rows add up to: their money (the figure's) and how many they are. */
export type AnalyticsRowsTotal = {
  readonly totalCents: PriceCents;
  readonly rowCount: number;
};

/** The base a count rate needs before it is shown as a rate (design G6). */
const RATE_BASE = 20;

function rateOf(count: number, base: number): number | null {
  return base >= RATE_BASE ? count / base : null;
}

function minutes(raw: number): MinuteCount {
  return raw as MinuteCount;
}

/** A seat's end on the shop's clock, in minutes of the day. */
function seatEnd(seat: Seat): number {
  return seat.startMinutes + seat.durationMinutes;
}

/** The figures one set of barbers earns over the period — shared by the report and each barber of a shop report. */
type Figures = {
  takingsCents: PriceCents;
  tipsCents: PriceCents;
  excludedVisitCount: number;
  rebookedCount: number;
  rebookedBase: number;
  noShowCount: number;
  noShowBase: number;
  lateCancellationCount: number;
};

function figuresOf(
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
  rebookedVisits: ReadonlySet<AppointmentId>,
  input: AnalyticsInput,
): Figures {
  const out: Figures = {
    takingsCents: PriceCents.ZERO,
    tipsCents: PriceCents.ZERO,
    excludedVisitCount: 0,
    rebookedCount: 0,
    rebookedBase: 0,
    noShowCount: 0,
    noShowBase: 0,
    lateCancellationCount: 0,
  };
  const today = input.now.localDate;
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const nets = MoneyAllocationSystem.seatNets(visit);
    const workedBarbers = new Set<BarberId>();
    let workedInScope = false;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (!inScope(seat.barberId)) continue;
      switch (seat.attendanceState) {
        case AttendanceState.Worked: {
          workedInScope = true;
          workedBarbers.add(seat.barberId);
          out.noShowBase++;
          if (nets.moneyAllocation === MoneyAllocation.Allocated) {
            const net = nets.nets[s] as SeatNet;
            out.takingsCents = PriceCents.add(out.takingsCents, net.netCents);
            out.tipsCents = PriceCents.add(out.tipsCents, net.tipCents);
          }
          break;
        }
        case AttendanceState.NoShow:
          out.noShowCount++;
          out.noShowBase++;
          break;
        case AttendanceState.Cancelled:
          if (
            ClientStatsSystem.clientCaused(seat) &&
            visit.bookedAtUtcMs !== null &&
            ClientStatsPolicy.isLateCancellation(
              input.policy,
              visit.utcEpochMs,
              seat.cancelledAtUtcMs,
              seat.cancellationWindowHours,
            )
          ) {
            out.lateCancellationCount++;
          }
          break;
        case AttendanceState.Scheduled:
          break;
      }
    }
    if (
      workedInScope &&
      nets.moneyAllocation === MoneyAllocation.NotEvaluated
    ) {
      out.excludedVisitCount++;
    }
    // Rebooking: a visit counts once for each barber with a worked seat on
    // it, once its window (its shop day and the next) has ended.
    if (LocalDate.addDays(visit.localDate, 1) < today) {
      out.rebookedBase += workedBarbers.size;
      if (rebookedVisits.has(visit.id)) {
        out.rebookedCount += workedBarbers.size;
      }
    }
  }
  return out;
}

/** The hero's takings over the compared days of one period. */
function heroTakings(
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
  from: LocalDate,
  comparedDays: number,
  cutDayIndex: number | null,
  cutMinute: number,
): PriceCents {
  let sum = PriceCents.ZERO;
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const index = LocalDate.daysBetween(from, visit.localDate);
    if (index < 0 || index >= comparedDays) continue;
    const nets = MoneyAllocationSystem.seatNets(visit);
    if (nets.moneyAllocation !== MoneyAllocation.Allocated) continue;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !inScope(seat.barberId)
      ) {
        continue;
      }
      if (index === cutDayIndex && seatEnd(seat) > cutMinute) continue;
      sum = PriceCents.add(sum, (nets.nets[s] as SeatNet).netCents);
    }
  }
  return sum;
}

/** Visits that have a live follow-up booked by the end of the next shop day. */
function rebookedSet(
  visits: readonly AnalyticsVisit[],
  followUps: readonly AnalyticsFollowUp[],
): ReadonlySet<AppointmentId> {
  const dayOf = new Map<AppointmentId, LocalDate>();
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    dayOf.set(visit.id, visit.localDate);
  }
  const rebooked = new Set<AppointmentId>();
  for (let f = 0; f < followUps.length; f++) {
    const followUp = followUps[f] as AnalyticsFollowUp;
    if (followUp.followUpCancelled) continue;
    const day = dayOf.get(followUp.bookedFromAppointmentId);
    if (day === undefined) continue;
    if (followUp.bookedOnLocalDate <= LocalDate.addDays(day, 1)) {
      rebooked.add(followUp.bookedFromAppointmentId);
    }
  }
  return rebooked;
}

type TimeTotals = {
  rostered: number;
  worked: number;
  noShow: number;
  unmarked: number;
  bookedAhead: number;
  held: number;
  blocked: number;
  breaks: number;
  shortGap: number;
  unsold: number;
  open: number;
  closed: number;
  outside: number;
  outsideSeats: number;
  pastBlocked: number;
  pastHeld: number;
  pastShortGap: number;
};

function timeOf(
  days: readonly AnalyticsDay[],
  inScope: (barberId: BarberId) => boolean,
): TimeTotals {
  const t: TimeTotals = {
    rostered: 0,
    worked: 0,
    noShow: 0,
    unmarked: 0,
    bookedAhead: 0,
    held: 0,
    blocked: 0,
    breaks: 0,
    shortGap: 0,
    unsold: 0,
    open: 0,
    closed: 0,
    outside: 0,
    outsideSeats: 0,
    pastBlocked: 0,
    pastHeld: 0,
    pastShortGap: 0,
  };
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    if (!inScope(day.barberId)) continue;
    t.rostered += day.rosteredMinutes;
    t.worked += day.workedMinutes;
    t.noShow += day.noShowMinutes;
    t.unmarked += day.unmarkedMinutes;
    t.bookedAhead += day.bookedAheadMinutes;
    t.held += day.heldMinutes;
    t.blocked += day.blockedMinutes;
    t.breaks += day.breakMinutes;
    t.shortGap += day.shortGapMinutes;
    t.unsold += day.unsoldMinutes;
    t.open += day.openMinutes;
    t.closed += day.closedDayMinutes;
    t.outside += day.outsideHoursMinutes;
    t.outsideSeats += day.outsideHoursSeatCount;
    t.pastBlocked += day.pastBlockedMinutes;
    t.pastHeld += day.pastHeldMinutes;
    t.pastShortGap += day.pastShortGapMinutes;
  }
  return t;
}

/** The next shop days the open-hours card reads: today and the six after it. */
const AHEAD_DAYS = 7;

/**
 * The longest period charted day by day (a quarter); a longer one is charted
 * per ISO week (design, `reportSeries`). Per month, for a `YEAR` span, comes
 * with that span.
 */
const DAY_GRAIN_MAX_DAYS = 93;

/** Days in an ISO week — the weekly grain's step. */
const DAYS_PER_WEEK = 7;

/**
 * How a period is cut into chart buckets: the first day of each, and whether
 * the buckets are weeks (else days). The weekly grain's first bucket runs
 * from the period's first day to the Sunday of its ISO week; every later
 * bucket starts on a Monday; the last ends with the period.
 */
type SeriesGrain = {
  readonly fromLocalDate: LocalDate;
  readonly toLocalDate: LocalDate;
  readonly weekly: boolean;
  readonly starts: readonly LocalDate[];
};

function grainOf(
  fromLocalDate: LocalDate,
  toLocalDate: LocalDate,
  weekly: boolean,
): SeriesGrain {
  if (!weekly) {
    return {
      fromLocalDate,
      toLocalDate,
      weekly,
      starts: LocalDate.range(fromLocalDate, toLocalDate),
    };
  }
  const starts: LocalDate[] = [fromLocalDate];
  let monday = LocalDate.addDays(
    LocalDate.startOfWeek(fromLocalDate),
    DAYS_PER_WEEK,
  );
  while (monday <= toLocalDate) {
    starts.push(monday);
    monday = LocalDate.addDays(monday, DAYS_PER_WEEK);
  }
  return { fromLocalDate, toLocalDate, weekly, starts };
}

/** The bucket `localDate` falls in, `-1` outside the grain's period. */
function bucketIndexOf(grain: SeriesGrain, localDate: LocalDate): number {
  if (localDate < grain.fromLocalDate || localDate > grain.toLocalDate) {
    return -1;
  }
  return grain.weekly
    ? Math.floor(
        LocalDate.daysBetween(
          LocalDate.startOfWeek(grain.fromLocalDate),
          localDate,
        ) / DAYS_PER_WEEK,
      )
    : LocalDate.daysBetween(grain.fromLocalDate, localDate);
}

/**
 * The net takings of the WORKED seats in scope per bucket — the
 * `reportTakingsCents` rule (an allocated bill's seat nets; a visit whose
 * bill could not be evaluated adds nothing), cut by the visit's shop day.
 */
function takingsByBucket(
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
  grain: SeriesGrain,
): readonly PriceCents[] {
  const out: PriceCents[] = [];
  for (let i = 0; i < grain.starts.length; i++) out.push(PriceCents.ZERO);
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const index = bucketIndexOf(grain, visit.localDate);
    if (index < 0) continue;
    const nets = MoneyAllocationSystem.seatNets(visit);
    if (nets.moneyAllocation !== MoneyAllocation.Allocated) continue;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !inScope(seat.barberId)
      ) {
        continue;
      }
      out[index] = PriceCents.add(
        out[index] as PriceCents,
        (nets.nets[s] as SeatNet).netCents,
      );
    }
  }
  return out;
}

/**
 * The takings line: this period's buckets against the comparison period's
 * at the same position — every comparison `null` when the period is not
 * comparable (`previous` is then `null`).
 */
function seriesOf(
  input: AnalyticsInput,
  inScope: (barberId: BarberId) => boolean,
  grain: SeriesGrain,
  previous: AnalyticsPeriod | null,
): readonly AnalyticsReport.SeriesPoint[] {
  const current = takingsByBucket(input.visits, inScope, grain);
  const compared =
    previous === null
      ? []
      : takingsByBucket(
          input.previousVisits,
          inScope,
          grainOf(previous.fromLocalDate, previous.toLocalDate, grain.weekly),
        );
  const out: AnalyticsReport.SeriesPoint[] = [];
  for (let i = 0; i < grain.starts.length; i++) {
    out.push({
      localDate: grain.starts[i] as LocalDate,
      takingsCents: current[i] as PriceCents,
      comparisonTakingsCents:
        i < compared.length ? (compared[i] as PriceCents) : null,
    });
  }
  return out;
}

/** The six bar parts per bucket — each day's as the `reportBar…` totals count them. */
function timeSeriesOf(
  days: readonly AnalyticsDay[],
  inScope: (barberId: BarberId) => boolean,
  grain: SeriesGrain,
): readonly AnalyticsReport.TimePoint[] {
  const out: {
    localDate: LocalDate;
    workedMinutes: MinuteCount;
    noShowMinutes: MinuteCount;
    unmarkedMinutes: MinuteCount;
    blockedMinutes: MinuteCount;
    unsoldMinutes: MinuteCount;
    otherMinutes: MinuteCount;
  }[] = [];
  for (let i = 0; i < grain.starts.length; i++) {
    out.push({
      localDate: grain.starts[i] as LocalDate,
      workedMinutes: MinuteCount.ZERO,
      noShowMinutes: MinuteCount.ZERO,
      unmarkedMinutes: MinuteCount.ZERO,
      blockedMinutes: MinuteCount.ZERO,
      unsoldMinutes: MinuteCount.ZERO,
      otherMinutes: MinuteCount.ZERO,
    });
  }
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (!inScope(day.barberId)) continue;
    const index = bucketIndexOf(grain, day.localDate);
    if (index < 0) continue;
    const point = out[index] as (typeof out)[number];
    point.workedMinutes = MinuteCount.add(
      point.workedMinutes,
      day.workedMinutes,
    );
    point.noShowMinutes = MinuteCount.add(
      point.noShowMinutes,
      day.noShowMinutes,
    );
    point.unmarkedMinutes = MinuteCount.add(
      point.unmarkedMinutes,
      day.unmarkedMinutes,
    );
    point.blockedMinutes = MinuteCount.add(
      point.blockedMinutes,
      day.pastBlockedMinutes,
    );
    point.unsoldMinutes = MinuteCount.add(
      point.unsoldMinutes,
      day.unsoldMinutes,
    );
    point.otherMinutes = MinuteCount.add(
      MinuteCount.add(point.otherMinutes, day.pastHeldMinutes),
      day.pastShortGapMinutes,
    );
  }
  return out;
}

/**
 * Each in-scope barber-day's hour buckets: its offered stretches and the
 * chair time of its WORKED seats (a wholly cancelled visit holds no chair,
 * as `ChairTimeSystem` reads it). A day with neither is skipped — it has no
 * cell to add to.
 */
function hourDaysOf(
  days: readonly AnalyticsDay[],
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
): readonly HourDay[] {
  const seatsOn = new Map<BusyKey, MinuteRange[]>();
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    if (visit.bookingStatus === BookingStatus.Cancelled) continue;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !inScope(seat.barberId)
      ) {
        continue;
      }
      const key = BusyKey.of(seat.barberId, visit.localDate);
      const list = seatsOn.get(key);
      const chair = Seat.chairTime(seat);
      if (list === undefined) seatsOn.set(key, [chair]);
      else list.push(chair);
    }
  }
  const out: HourDay[] = [];
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (!inScope(day.barberId)) continue;
    const seats = seatsOn.get(BusyKey.of(day.barberId, day.localDate));
    if (day.stretches.length === 0 && seats === undefined) continue;
    out.push(
      AnalyticsHourSystem.bucketsOf(day.localDate, seats ?? [], day.stretches),
    );
  }
  return out;
}

/** How many distinct shop days of the period roster any minute in scope — the heatmap sentence's base. */
function rosteredDayCountOf(
  days: readonly AnalyticsDay[],
  inScope: (barberId: BarberId) => boolean,
): number {
  const dates = new Set<LocalDate>();
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (inScope(day.barberId) && day.rosteredMinutes > 0) {
      dates.add(day.localDate);
    }
  }
  return dates.size;
}

/** The minutes `input`'s day would roster — its windows, blocks and breaks, normalized. */
function rosteredMinutesOf(input: BuildDayWindowsInput): MinuteCount {
  return IntervalSetSystem.totalMinutes(
    IntervalSetSystem.normalize([
      ...RosterSystem.offeredWindows(input),
      ...RosterSystem.offeredCarveOuts(input),
      ...RosterSystem.offeredBreaks(input),
    ]),
  );
}

/** The clock of the shop the day is worked at — its first offered stretch's — else the report's. */
function nowOf(
  stretches: readonly { readonly locationId: LocationId }[],
  nowByLocation: readonly ShopNowAt[],
  fallback: ShopNow,
): ShopNow {
  const first = stretches[0];
  if (first === undefined) return fallback;
  for (let i = 0; i < nowByLocation.length; i++) {
    const at = nowByLocation[i] as ShopNowAt;
    if (at.locationId === first.locationId) return at;
  }
  return fallback;
}

/**
 * STAFF ANALYTICS (`docs/designs/staff-analytics.md`, catalogue v1) — the
 * visibility table and the report, every value decided here so a presenter
 * only words it (Law 10).
 */
export const StaffAnalyticsSystem = {
  RATE_BASE,
  AHEAD_DAYS,
  DAY_GRAIN_MAX_DAYS,

  /**
   * The first day of each bucket the charts cut `period` into
   * (`reportSeries`, `reportTimeSeries`): every day for a period of up to
   * {@link DAY_GRAIN_MAX_DAYS} days; beyond that the period's first day and
   * then every Monday inside it — a partial first or last ISO week is a
   * bucket of its own.
   */
  seriesStartsOf(period: AnalyticsPeriod): readonly LocalDate[] {
    return grainOf(
      period.fromLocalDate,
      period.toLocalDate,
      AnalyticsPeriod.length(period) > DAY_GRAIN_MAX_DAYS,
    ).starts;
  },

  /**
   * The caller as the visibility table judges them, from their STORED user
   * record: its roles, whether it is blocked at the call's instant (a T2
   * expiry, `AccountLifecycle.isBlockedAt`) and its barber link
   * (`StaffLink.of`, an absent or malformed field read as none). No record
   * at all is `ANALYTICS_FORBIDDEN` — an account that never signed in has
   * no roles to read.
   */
  callerOf(
    user: User | null,
    nowUtcMs: UtcEpochMs,
  ): Result<AnalyticsCaller, AnalyticsError> {
    if (user === null) return Result.err(AnalyticsError.forbidden());
    return Result.ok({
      callerRoles: user.roles,
      callerBlocked: AccountLifecycle.isBlockedAt(user, nowUtcMs),
      linkedBarberId: StaffLink.of(user).linkedBarberId,
    });
  },

  /**
   * The shop whose clock says what "today" is: the deployment's default
   * shop when it is listed, else the first by id (any status — a zone is
   * configuration); `null` with no shop at all.
   */
  clockLocationOf(
    locations: readonly ShopLocation[],
    defaultLocationId: LocationId,
  ): ShopLocation | null {
    let first: ShopLocation | null = null;
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i] as ShopLocation;
      if (location.id === defaultLocationId) return location;
      if (first === null || location.id < first.id) first = location;
    }
    return first;
  },

  /** The barber records a scope reports on: the one, or every record of the shop by id. */
  barbersInScope(
    scopeBarberId: BarberId | null,
    barberIds: readonly BarberId[],
  ): readonly BarberId[] {
    return scopeBarberId === null ? [...barberIds].sort() : [scopeBarberId];
  },

  /** The shop days the open-hours card reads: `today` and the six after it. */
  aheadDaysOf(today: LocalDate): readonly LocalDate[] {
    return LocalDate.range(today, LocalDate.addDays(today, AHEAD_DAYS - 1));
  },

  /** Every barber-day's busy key (`barberId__localDate`), barber by barber — what a visit read asks for. */
  busyKeysOf(
    barberIds: readonly BarberId[],
    localDates: readonly LocalDate[],
  ): readonly BusyKey[] {
    const keys: BusyKey[] = [];
    for (let b = 0; b < barberIds.length; b++) {
      for (let d = 0; d < localDates.length; d++) {
        keys.push(
          BusyKey.of(barberIds[b] as BarberId, localDates[d] as LocalDate),
        );
      }
    }
    return keys;
  },

  /**
   * Each appointment once, in first-read order — a party split across
   * barbers holds a key of each, so it can come back from two queries.
   */
  mergeVisits<V extends { readonly id: AppointmentId }>(
    visits: readonly V[],
  ): readonly V[] {
    const seen = new Set<AppointmentId>();
    const out: V[] = [];
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as V;
      if (seen.has(visit.id)) continue;
      seen.add(visit.id);
      out.push(visit);
    }
    return out;
  },

  /**
   * The visits a barber's follow-ups are read by: those in the rebooking
   * base — a `WORKED` seat of the barber, the window (its shop day and the
   * next) ended before `today` — the only ones a follow-up can count for.
   */
  followUpSourcesOf(
    visits: readonly AnalyticsVisit[],
    barberId: BarberId,
    today: LocalDate,
  ): readonly AppointmentId[] {
    const ids: AppointmentId[] = [];
    for (let v = 0; v < visits.length; v++) {
      const visit = visits[v] as AnalyticsVisit;
      if (!(LocalDate.addDays(visit.localDate, 1) < today)) continue;
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as Seat;
        if (
          seat.barberId === barberId &&
          seat.attendanceState === AttendanceState.Worked
        ) {
          ids.push(visit.id);
          break;
        }
      }
    }
    return ids;
  },

  /**
   * Whether a read visit is a follow-up the rebooking rule can judge:
   * booked from another visit, at a known instant (a row stamped before
   * `bookedAtUtcMs` existed is left out, as the catalogue says).
   */
  isCountedFollowUp(visit: FollowUpVisit): visit is CountedFollowUp {
    return (
      visit.bookedFromAppointmentId !== null && visit.bookedAtUtcMs !== null
    );
  },

  /**
   * A follow-up as the report reads it: the visit it was booked from, the
   * shop day it was booked on (converted once, at the pipeline's boundary,
   * on its shop's clock) and whether it is cancelled now.
   */
  followUpOf(
    visit: CountedFollowUp,
    bookedOnLocalDate: LocalDate,
  ): AnalyticsFollowUp {
    return {
      bookedFromAppointmentId: visit.bookedFromAppointmentId,
      bookedOnLocalDate,
      followUpCancelled: visit.bookingStatus === BookingStatus.Cancelled,
    };
  },

  /**
   * THE SCOPE'S BARBER-DAYS, partitioned (`ChairTimeSystem.dayBreakdown`),
   * barber by barber and day by day. Each day is the schedule's own: the
   * roster in force, its departure, the hours of the ACTIVE shops
   * (`PartyAdmissionSystem.shopListed` — the rule every booking surface
   * and the capacity rebuild ask), read through `RosterSystem`'s offered
   * windows, blocks and breaks; the day's clock is its shop's (the first
   * offered stretch's), else the report's. A `CLOSED` day rosters nothing;
   * its `closedDayMinutes` are what the roster would have given without
   * the departure.
   */
  daysOf(input: AnalyticsDaysInput): readonly AnalyticsDay[] {
    const active: ShopLocation[] = [];
    for (let i = 0; i < input.locations.length; i++) {
      const location = input.locations[i] as ShopLocation;
      if (PartyAdmissionSystem.shopListed(location)) active.push(location);
    }
    const rosterOf = new Map<BarberId, BarberSchedule>();
    for (let i = 0; i < input.rosters.length; i++) {
      const roster = input.rosters[i] as BarberSchedule;
      rosterOf.set(roster.id, roster);
    }
    const departuresOf = new Map<BarberId, ScheduleException[]>();
    for (let i = 0; i < input.departures.length; i++) {
      const departure = input.departures[i] as ScheduleException;
      const list = departuresOf.get(departure.barberId);
      if (list === undefined) departuresOf.set(departure.barberId, [departure]);
      else list.push(departure);
    }
    const visitsOn = new Map<LocalDate, ChairVisit[]>();
    for (let i = 0; i < input.visits.length; i++) {
      const visit = input.visits[i] as AnalyticsVisit;
      const list = visitsOn.get(visit.localDate);
      if (list === undefined) visitsOn.set(visit.localDate, [visit]);
      else list.push(visit);
    }

    const days: AnalyticsDay[] = [];
    for (let b = 0; b < input.barberIds.length; b++) {
      const barberId = input.barberIds[b] as BarberId;
      const versions = rosterOf.get(barberId)?.versions ?? [];
      const exceptions = departuresOf.get(barberId) ?? [];
      for (let d = 0; d < input.localDates.length; d++) {
        const localDate = input.localDates[d] as LocalDate;
        const shopHours = RosterSystem.shopHoursOn(active, localDate);
        const day: BuildDayWindowsInput = {
          barberId,
          localDate,
          versions,
          exceptions,
          shopHours,
        };
        const windows = RosterSystem.offeredWindows(day);
        const blocks = RosterSystem.offeredCarveOuts(day);
        const breaks = RosterSystem.offeredBreaks(day);
        const stretches = IntervalSetSystem.normalize([
          ...windows,
          ...blocks,
          ...breaks,
        ]);
        const closed = exceptions.some(
          (exception) =>
            exception.localDate === localDate &&
            exception.exceptionEffect === ExceptionEffect.Closed,
        );
        const chairDay = ChairTimeSystem.dayBreakdown({
          barberId,
          localDate,
          windows,
          blocks,
          breaks,
          visits: visitsOn.get(localDate) ?? [],
          now: nowOf(
            windows.length > 0 ? windows : [...blocks, ...breaks],
            input.nowByLocation,
            input.now,
          ),
        });
        days.push({
          ...chairDay,
          stretches,
          closedDayMinutes: closed
            ? rosteredMinutesOf({
                ...day,
                exceptions: exceptions.filter(
                  (exception) => exception.localDate !== localDate,
                ),
              })
            : MinuteCount.ZERO,
        });
      }
    }
    return days;
  },

  /**
   * THE VISIBILITY TABLE, read top-down on the caller's STORED roles: a
   * blocked account sees nothing; an admin sees the shop (`null`) or any
   * known barber record; a barber sees only the record their account is
   * linked to; every other role nothing. Answers the scope — a barber record
   * or `null` for the shop.
   */
  scopeOf(
    caller: AnalyticsCaller,
    request: AnalyticsCall,
    barberIds: readonly BarberId[],
  ): Result<BarberId | null, AnalyticsError> {
    if (caller.callerBlocked) return Result.err(AnalyticsError.forbidden());
    if (Roles.readsAnalytics(caller.callerRoles)) {
      const isAdmin = caller.callerRoles.some((role) =>
        (Roles.ANALYTICS_SHOP as readonly Role[]).includes(role),
      );
      if (isAdmin) {
        if (request.scopeBarberId === null) return Result.ok(null);
        return barberIds.includes(request.scopeBarberId)
          ? Result.ok(request.scopeBarberId)
          : Result.err(AnalyticsError.scopeUnknown(request.scopeBarberId));
      }
      if (caller.linkedBarberId === null) {
        return Result.err(AnalyticsError.barberNotLinked());
      }
      return request.scopeBarberId === null ||
        request.scopeBarberId === caller.linkedBarberId
        ? Result.ok(caller.linkedBarberId)
        : Result.err(AnalyticsError.forbidden());
    }
    return Result.err(AnalyticsError.forbidden());
  },

  report(input: AnalyticsInput): AnalyticsReport {
    const scope = new Set<BarberId>(input.barberIds);
    const inScope = (barberId: BarberId): boolean => scope.has(barberId);
    const rebooked = rebookedSet(input.visits, input.followUps);
    const figures = figuresOf(input.visits, inScope, rebooked, input);
    const time = timeOf(input.days, inScope);

    // The hero: the compared days of this period against the comparison
    // period's — the same elapsed days, the counterpart day (a DAY's whole
    // comparison) cut at the current minute while the period runs. No
    // comparison at all when the period is not comparable (its comparison
    // period would start before the reach).
    const period = input.period;
    const today = input.now.localDate;
    const previous = AnalyticsPeriod.isComparable(period, today)
      ? AnalyticsPeriod.previous(period)
      : null;
    const running =
      period.fromLocalDate <= today && today <= period.toLocalDate;
    const length = AnalyticsPeriod.length(period);
    const compared = running
      ? LocalDate.daysBetween(period.fromLocalDate, today) + 1
      : length;
    const cutIndex = running ? compared - 1 : null;
    const heroCurrent = heroTakings(
      input.visits,
      inScope,
      period.fromLocalDate,
      compared,
      cutIndex,
      input.now.currentMinute,
    );
    const hadPrevious =
      previous !== null &&
      input.previousVisits.some((visit) =>
        visit.seats.some(
          (seat) =>
            inScope(seat.barberId) &&
            seat.attendanceState === AttendanceState.Worked,
        ),
      );
    const previousCompared =
      previous === null
        ? 0
        : Math.min(compared, AnalyticsPeriod.length(previous));
    const heroPrevious =
      previous !== null && hadPrevious
        ? heroTakings(
            input.previousVisits,
            inScope,
            previous.fromLocalDate,
            previousCompared,
            cutIndex !== null && cutIndex < previousCompared ? cutIndex : null,
            input.now.currentMinute,
          )
        : null;

    // The charts: the period cut into buckets, the hour grid and its peaks.
    const grain = grainOf(
      period.fromLocalDate,
      period.toLocalDate,
      length > DAY_GRAIN_MAX_DAYS,
    );
    const hourGrid = AnalyticsHourSystem.grid(
      hourDaysOf(input.days, input.visits, inScope),
    );
    const peaks = AnalyticsHourSystem.peak(
      hourGrid,
      rosteredDayCountOf(input.days, inScope),
    );

    return {
      reportDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      reportComputedAtUtcMs: input.now.utcEpochMs,
      reportScopeBarberId: input.scopeBarberId,
      reportAnalyticsSpan: period.analyticsSpan,
      reportFromLocalDate: period.fromLocalDate,
      reportToLocalDate: period.toLocalDate,
      reportAnalyticsComparison: input.analyticsComparison,
      reportComparisonFromLocalDate:
        previous === null ? null : previous.fromLocalDate,
      reportComparisonToLocalDate:
        previous === null ? null : previous.toLocalDate,

      reportRosteredMinutes: minutes(time.rostered),
      reportWorkedMinutes: minutes(time.worked),
      reportNoShowMinutes: minutes(time.noShow),
      reportUnmarkedMinutes: minutes(time.unmarked),
      reportBookedAheadMinutes: minutes(time.bookedAhead),
      reportHeldMinutes: minutes(time.held),
      reportBlockedMinutes: minutes(time.blocked),
      reportBreakMinutes: minutes(time.breaks),
      reportShortGapMinutes: minutes(time.shortGap),
      reportUnsoldMinutes: minutes(time.unsold),
      reportOpenMinutes: minutes(time.open),
      reportClosedDayMinutes: minutes(time.closed),
      reportOutsideHoursMinutes: minutes(time.outside),
      reportOutsideHoursSeatCount: time.outsideSeats,

      reportBarWorkedMinutes: minutes(time.worked),
      reportBarNoShowMinutes: minutes(time.noShow),
      reportBarUnmarkedMinutes: minutes(time.unmarked),
      reportBarBlockedMinutes: minutes(time.pastBlocked),
      reportBarUnsoldMinutes: minutes(time.unsold),
      reportBarOtherMinutes: minutes(time.pastHeld + time.pastShortGap),

      reportTakingsCents: figures.takingsCents,
      reportTipsCents: figures.tipsCents,
      reportExcludedVisitCount: figures.excludedVisitCount,
      reportHeroCurrentCents: heroCurrent,
      reportHeroPreviousCents: heroPrevious,

      reportRebookedCount: figures.rebookedCount,
      reportRebookedBase: figures.rebookedBase,
      reportRebookedRate: rateOf(figures.rebookedCount, figures.rebookedBase),
      reportNoShowCount: figures.noShowCount,
      reportNoShowBase: figures.noShowBase,
      reportNoShowRate: rateOf(figures.noShowCount, figures.noShowBase),
      reportLateCancellationCount: figures.lateCancellationCount,

      ...bookableOf(input.aheadDays, inScope, today),

      reportBusiestWeekday:
        peaks.busiest === null ? null : peaks.busiest.weekday,
      reportBusiestHour: peaks.busiest === null ? null : peaks.busiest.hour,
      reportEmptiestWeekday:
        peaks.emptiest === null ? null : peaks.emptiest.weekday,
      reportEmptiestHour: peaks.emptiest === null ? null : peaks.emptiest.hour,

      reportSeries: seriesOf(input, inScope, grain, previous),
      reportTimeSeries: timeSeriesOf(input.days, inScope, grain),
      reportHourGrid: hourGrid,

      reportServices: servicesOf(input.visits, inScope),
      reportWeekdayFill: weekdayFillOf(input.days, inScope, today),
      reportOrigins: originsOf(input.visits, inScope),
      reportBarbers:
        input.scopeBarberId === null ? barbersOf(input, rebooked) : [],
      reportDayRows: dayRowsOf(input.days, inScope),
      reportSeatRows:
        input.scopeBarberId === null
          ? []
          : seatRowsOf(input, rebooked, input.scopeBarberId),
    };
  },

  /**
   * The seat rows behind a money or count figure, narrowed by `filter` — the
   * rows a drill-down lists, which add up to the figure: their `netCents`
   * to `TAKINGS`, their `tipCents` to `TIPS`, their count to the others.
   */
  seatRowsFor(
    report: AnalyticsReport,
    figure: AnalyticsFigure,
    filter: AnalyticsRowFilter,
  ): readonly AnalyticsReport.SeatRow[] {
    const out: AnalyticsReport.SeatRow[] = [];
    for (let i = 0; i < report.reportSeatRows.length; i++) {
      const row = report.reportSeatRows[i] as AnalyticsReport.SeatRow;
      if (filter.serviceId !== null && row.serviceId !== filter.serviceId) {
        continue;
      }
      if (filter.localDate !== null && row.localDate !== filter.localDate) {
        continue;
      }
      if (seatRowCounts(row, figure)) out.push(row);
    }
    return out;
  },

  /** The day rows behind the time figures, narrowed by `filter.localDate`. */
  dayRowsFor(
    report: AnalyticsReport,
    filter: AnalyticsRowFilter,
  ): readonly AnalyticsReport.DayRow[] {
    return filter.localDate === null
      ? report.reportDayRows
      : report.reportDayRows.filter(
          (row) => row.localDate === filter.localDate,
        );
  },
  /**
   * The hero's change (design, «Comparison»): `NONE` with no previous
   * period, else the direction of the compared days' takings, and the rate
   * of change when the previous takings are not 0.
   */
  heroChangeOf(report: AnalyticsReport): AnalyticsHeroChange {
    const previous = report.reportHeroPreviousCents;
    if (previous === null) {
      return { heroChange: HeroChange.None, heroChangeRate: null };
    }
    const current = report.reportHeroCurrentCents;
    const heroChange =
      current > previous
        ? HeroChange.Up
        : current < previous
          ? HeroChange.Down
          : HeroChange.Flat;
    return {
      heroChange,
      heroChangeRate: previous > 0 ? (current - previous) / previous : null,
    };
  },

  /**
   * The time bar up to now, in its order — worked, no-show, unmarked,
   * blocked, unsold, other — each with its share of the bar's whole. Every
   * segment is listed, an empty one at 0, so the legend keeps its rows.
   */
  barSegmentsOf(report: AnalyticsReport): readonly AnalyticsBarSegment[] {
    const parts: readonly (readonly [AnalyticsBarPart, MinuteCount])[] = [
      [AnalyticsBarPart.Worked, report.reportBarWorkedMinutes],
      [AnalyticsBarPart.NoShow, report.reportBarNoShowMinutes],
      [AnalyticsBarPart.Unmarked, report.reportBarUnmarkedMinutes],
      [AnalyticsBarPart.Blocked, report.reportBarBlockedMinutes],
      [AnalyticsBarPart.Unsold, report.reportBarUnsoldMinutes],
      [AnalyticsBarPart.Other, report.reportBarOtherMinutes],
    ];
    let whole = 0;
    for (let i = 0; i < parts.length; i++)
      whole += (parts[i] as readonly [AnalyticsBarPart, MinuteCount])[1];
    return parts.map(([analyticsBarPart, partMinutes]) => ({
      analyticsBarPart,
      minutes: partMinutes,
      share: whole > 0 ? partMinutes / whole : 0,
    }));
  },

  /** Each service row's share of the services' takings, in the report's order; `0` each when nothing was taken. */
  serviceSharesOf(report: AnalyticsReport): readonly number[] {
    return sharesOf(report.reportServices.map((row) => row.takingsCents));
  },

  /**
   * The takings line's dashed rule: the mean of
   * {@link AnalyticsReport.reportSeries}' points, in whole cents (rounded);
   * `null` with no points.
   */
  seriesAverageCentsOf(report: AnalyticsReport): PriceCents | null {
    const points = report.reportSeries;
    if (points.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      sum += (points[i] as AnalyticsReport.SeriesPoint).takingsCents;
    }
    const average = PriceCents.of(Math.round(sum / points.length));
    return average.ok ? average.value : null;
  },

  /** Each origin's share of the counted visits, in the report's order; `0` each with none. */
  originSharesOf(report: AnalyticsReport): readonly number[] {
    return sharesOf(report.reportOrigins.map((row) => row.visitCount));
  },

  /** Which sections and states the screen shows for `report`. */
  screenOf(report: AnalyticsReport): AnalyticsScreen {
    const shopScope = report.reportScopeBarberId === null;
    return {
      shopScope,
      drillsToSeats: !shopScope,
      periodEmpty:
        report.reportWorkedMinutes +
          report.reportNoShowMinutes +
          report.reportUnmarkedMinutes +
          report.reportBookedAheadMinutes +
          report.reportHeldMinutes ===
          0 &&
        report.reportTakingsCents === 0 &&
        report.reportNoShowCount === 0 &&
        report.reportLateCancellationCount === 0,
      rostered: report.reportRosteredMinutes > 0,
      smallSample:
        (report.reportRebookedRate === null && report.reportRebookedBase > 0) ||
        (report.reportNoShowRate === null && report.reportNoShowBase > 0),
      opensEmptiestDay: report.reportEmptiestLocalDate !== null,
      excludesVisits: report.reportExcludedVisitCount > 0,
    };
  },

  /**
   * The admin's scope picker, in its order (design, «Which barber the
   * caller is»): the shop first — an admin opens on it — then the admin's
   * own linked record («Аз»), then every other record as listed.
   */
  scopeChoicesOf(
    barberIds: readonly BarberId[],
    linkedBarberId: BarberId | null,
  ): readonly AnalyticsScopeChoice[] {
    const out: AnalyticsScopeChoice[] = [
      { scopeBarberId: null, scopeMine: false },
    ];
    if (linkedBarberId !== null) {
      out.push({ scopeBarberId: linkedBarberId, scopeMine: true });
    }
    for (let i = 0; i < barberIds.length; i++) {
      const barberId = barberIds[i] as BarberId;
      if (barberId !== linkedBarberId) {
        out.push({ scopeBarberId: barberId, scopeMine: false });
      }
    }
    return out;
  },

  /** Whether the report was computed on `today` of the shop in `timeZone` — its time alone then says when. */
  computedOn(
    report: AnalyticsReport,
    timeZone: TimeZone,
    today: LocalDate,
  ): boolean {
    return (
      ZonedTimeSystem.shopNow(report.reportComputedAtUtcMs, timeZone)
        .localDate === today
    );
  },

  /**
   * The period before and after `period` of its span — the week or month
   * before and after, the day before and after (a `DAY` steps by one day;
   * its COMPARISON is a week back, `AnalyticsPeriod.previous`) — each only
   * when it may be asked for on `today` (`AnalyticsPeriod.isWithinRange`:
   * back no further than the reach, forward never past today): the switcher
   * never offers what the callable refuses.
   */
  stepsOf(period: AnalyticsPeriod, today: LocalDate): AnalyticsSteps {
    const previous = AnalyticsPeriod.holding(
      period.analyticsSpan,
      LocalDate.addDays(period.fromLocalDate, -1),
    );
    const next = AnalyticsPeriod.holding(
      period.analyticsSpan,
      LocalDate.addDays(period.toLocalDate, 1),
    );
    return {
      previous: AnalyticsPeriod.isWithinRange(previous, today)
        ? previous
        : null,
      next: AnalyticsPeriod.isWithinRange(next, today) ? next : null,
    };
  },

  /**
   * The period of `span` a switch from `period` lands on. To a `DAY`: today
   * when `period` holds it, else `period`'s first day. To a `WEEK` or a
   * `MONTH`: the one holding `period`'s last day, or today when that is
   * later — so a past month switches to its last week, the current one to
   * this week, a day to the week or month holding it — and this span's
   * current period when the one landed on is out of reach.
   */
  periodInSpan(
    period: AnalyticsPeriod,
    span: AnalyticsSpan,
    today: LocalDate,
  ): AnalyticsPeriod {
    if (span === period.analyticsSpan) return period;
    const running =
      period.fromLocalDate <= today && today <= period.toLocalDate;
    const day =
      span === AnalyticsSpan.Day
        ? running
          ? today
          : period.fromLocalDate
        : period.toLocalDate < today
          ? period.toLocalDate
          : today;
    const landed = AnalyticsPeriod.holding(span, day);
    return AnalyticsPeriod.isWithinRange(landed, today)
      ? landed
      : AnalyticsPeriod.holding(span, today);
  },

  /**
   * What a drill-down's seat rows add up to for `figure` — the footer: their
   * nets for `TAKINGS`, their tips for `TIPS`, no money for the counts.
   */
  seatRowsTotalOf(
    rows: readonly AnalyticsReport.SeatRow[],
    figure: AnalyticsFigure,
  ): AnalyticsRowsTotal {
    let total = PriceCents.ZERO;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as AnalyticsReport.SeatRow;
      if (figure === AnalyticsFigure.Takings) {
        total = PriceCents.add(total, row.netCents);
      } else if (figure === AnalyticsFigure.Tips) {
        total = PriceCents.add(total, row.tipCents);
      }
    }
    return { totalCents: total, rowCount: rows.length };
  },

  /** The rebooked rows among a `REBOOKED` drill-down's — its footer's «n of m». */
  rebookedCountOf(rows: readonly AnalyticsReport.SeatRow[]): number {
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] as AnalyticsReport.SeatRow).seatRebooked === true) count++;
    }
    return count;
  },
} as const;

/** Each value's share of their sum; `0` each when the sum is 0. */
function sharesOf(values: readonly number[]): readonly number[] {
  let whole = 0;
  for (let i = 0; i < values.length; i++) whole += values[i] as number;
  return values.map((value) => (whole > 0 ? value / whole : 0));
}

function seatRowCounts(
  row: AnalyticsReport.SeatRow,
  figure: AnalyticsFigure,
): boolean {
  switch (figure) {
    case AnalyticsFigure.Takings:
    case AnalyticsFigure.Tips:
      return row.attendanceState === AttendanceState.Worked;
    case AnalyticsFigure.NoShows:
      return row.attendanceState === AttendanceState.NoShow;
    case AnalyticsFigure.LateCancellations:
      return row.seatLateCancelled;
    case AnalyticsFigure.Rebooked:
      return row.seatRebooked !== null;
    case AnalyticsFigure.Time:
      return false;
  }
}

/**
 * The open-hours card: today and the six days after it, each with the open
 * (still bookable) minutes in scope; their total, and the emptiest — the day
 * with the most open minutes, the earliest on a tie, `null` when none is
 * open. One rule for the three, so the bars sum to the total.
 */
function bookableOf(
  aheadDays: readonly ChairDay[],
  inScope: (barberId: BarberId) => boolean,
  today: LocalDate,
): {
  readonly reportBookableOpenMinutes: MinuteCount;
  readonly reportEmptiestLocalDate: LocalDate | null;
  readonly reportAheadDays: readonly AnalyticsReport.AheadDay[];
} {
  const dates = StaffAnalyticsSystem.aheadDaysOf(today);
  const open: MinuteCount[] = [];
  for (let i = 0; i < dates.length; i++) open.push(MinuteCount.ZERO);
  for (let i = 0; i < aheadDays.length; i++) {
    const day = aheadDays[i] as ChairDay;
    if (!inScope(day.barberId)) continue;
    const index = LocalDate.daysBetween(today, day.localDate);
    if (index < 0 || index >= dates.length) continue;
    open[index] = MinuteCount.add(open[index] as MinuteCount, day.openMinutes);
  }
  const rows: AnalyticsReport.AheadDay[] = [];
  let total = MinuteCount.ZERO;
  let emptiest: LocalDate | null = null;
  let most = 0;
  for (let i = 0; i < dates.length; i++) {
    const localDate = dates[i] as LocalDate;
    const openMinutes = open[i] as MinuteCount;
    rows.push({ localDate, openMinutes });
    total = MinuteCount.add(total, openMinutes);
    if (openMinutes > most) {
      most = openMinutes;
      emptiest = localDate;
    }
  }
  return {
    reportBookableOpenMinutes: total,
    reportEmptiestLocalDate: emptiest,
    reportAheadDays: rows,
  };
}

function servicesOf(
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
): readonly AnalyticsReport.ServiceRow[] {
  const rows = new Map<
    ServiceId,
    { count: number; takings: PriceCents; minutes: number }
  >();
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const nets = MoneyAllocationSystem.seatNets(visit);
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !inScope(seat.barberId)
      ) {
        continue;
      }
      const row = rows.get(seat.serviceId) ?? {
        count: 0,
        takings: PriceCents.ZERO,
        minutes: 0,
      };
      row.count++;
      row.minutes += seat.durationMinutes;
      if (nets.moneyAllocation === MoneyAllocation.Allocated) {
        row.takings = PriceCents.add(
          row.takings,
          (nets.nets[s] as SeatNet).netCents,
        );
      }
      rows.set(seat.serviceId, row);
    }
  }
  const out: AnalyticsReport.ServiceRow[] = [];
  for (const [serviceId, row] of rows) {
    out.push({
      serviceId,
      workedSeatCount: row.count,
      takingsCents: row.takings,
      serviceMinutes: minutes(row.minutes),
      takingsPerHourCents:
        row.minutes > 0
          ? (Math.round((row.takings * 60) / row.minutes) as PriceCents)
          : null,
    });
  }
  // Most takings first; a tie by service id, so the order is stable.
  return out.sort(
    (a, b) =>
      b.takingsCents - a.takingsCents ||
      (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0),
  );
}

function weekdayFillOf(
  days: readonly AnalyticsDay[],
  inScope: (barberId: BarberId) => boolean,
  today: LocalDate,
): readonly AnalyticsReport.WeekdayFill[] {
  const byWeekday = new Map<Weekday, { filled: number; capacity: number }>();
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    if (!inScope(day.barberId) || day.localDate >= today) continue;
    const weekday = LocalDate.weekday(day.localDate);
    const entry = byWeekday.get(weekday) ?? { filled: 0, capacity: 0 };
    entry.filled += day.workedMinutes + day.noShowMinutes + day.unmarkedMinutes;
    entry.capacity += day.rosteredMinutes - day.breakMinutes;
    byWeekday.set(weekday, entry);
  }
  const out: AnalyticsReport.WeekdayFill[] = [];
  for (const [weekday, entry] of byWeekday) {
    out.push({
      weekday,
      filledMinutes: minutes(entry.filled),
      capacityMinutes: minutes(entry.capacity),
      fillRate: entry.capacity > 0 ? entry.filled / entry.capacity : null,
    });
  }
  return out.sort((a, b) => a.weekday - b.weekday);
}

function originsOf(
  visits: readonly AnalyticsVisit[],
  inScope: (barberId: BarberId) => boolean,
): readonly AnalyticsReport.OriginShare[] {
  let online = 0;
  let staff = 0;
  let unknown = 0;
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const counts = visit.seats.some(
      (seat) =>
        inScope(seat.barberId) &&
        seat.attendanceState === AttendanceState.Worked,
    );
    if (!counts) continue;
    if (visit.placement === Placement.Self) online++;
    else if (visit.placement === Placement.Staff) staff++;
    else unknown++;
  }
  return [
    { bookingOrigin: BookingOrigin.Online, visitCount: online },
    { bookingOrigin: BookingOrigin.Staff, visitCount: staff },
    { bookingOrigin: BookingOrigin.Unknown, visitCount: unknown },
  ];
}

function barbersOf(
  input: AnalyticsInput,
  rebooked: ReadonlySet<AppointmentId>,
): readonly AnalyticsReport.BarberFigures[] {
  const out: AnalyticsReport.BarberFigures[] = [];
  for (let b = 0; b < input.barberIds.length; b++) {
    const barberId = input.barberIds[b] as BarberId;
    const only = (id: BarberId): boolean => id === barberId;
    const figures = figuresOf(input.visits, only, rebooked, input);
    const time = timeOf(input.days, only);
    out.push({
      barberId,
      rosteredMinutes: minutes(time.rostered),
      workedMinutes: minutes(time.worked),
      noShowMinutes: minutes(time.noShow),
      unmarkedMinutes: minutes(time.unmarked),
      blockedMinutes: minutes(time.blocked),
      unsoldMinutes: minutes(time.unsold),
      openMinutes: minutes(time.open),
      takingsCents: figures.takingsCents,
      tipsCents: figures.tipsCents,
      rebookedCount: figures.rebookedCount,
      rebookedBase: figures.rebookedBase,
      rebookedRate: rateOf(figures.rebookedCount, figures.rebookedBase),
      noShowCount: figures.noShowCount,
      noShowBase: figures.noShowBase,
      noShowRate: rateOf(figures.noShowCount, figures.noShowBase),
      lateCancellationCount: figures.lateCancellationCount,
    });
  }
  return out;
}

function dayRowsOf(
  days: readonly AnalyticsDay[],
  inScope: (barberId: BarberId) => boolean,
): readonly AnalyticsReport.DayRow[] {
  const out: AnalyticsReport.DayRow[] = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    if (!inScope(day.barberId)) continue;
    out.push({
      barberId: day.barberId,
      localDate: day.localDate,
      rosteredMinutes: day.rosteredMinutes,
      workedMinutes: day.workedMinutes,
      noShowMinutes: day.noShowMinutes,
      unmarkedMinutes: day.unmarkedMinutes,
      bookedAheadMinutes: day.bookedAheadMinutes,
      heldMinutes: day.heldMinutes,
      blockedMinutes: day.blockedMinutes,
      breakMinutes: day.breakMinutes,
      shortGapMinutes: day.shortGapMinutes,
      unsoldMinutes: day.unsoldMinutes,
      openMinutes: day.openMinutes,
      closedDayMinutes: day.closedDayMinutes,
    });
  }
  return out.sort(
    (a, b) =>
      (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0) ||
      (a.barberId < b.barberId ? -1 : a.barberId > b.barberId ? 1 : 0),
  );
}

function seatRowsOf(
  input: AnalyticsInput,
  rebooked: ReadonlySet<AppointmentId>,
  barberId: BarberId,
): readonly AnalyticsReport.SeatRow[] {
  const today = input.now.localDate;
  const out: AnalyticsReport.SeatRow[] = [];
  for (let v = 0; v < input.visits.length; v++) {
    const visit = input.visits[v] as AnalyticsVisit;
    const nets = MoneyAllocationSystem.seatNets(visit);
    const inBase = LocalDate.addDays(visit.localDate, 1) < today;
    let rebookMarked = false;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (seat.barberId !== barberId) continue;
      const worked = seat.attendanceState === AttendanceState.Worked;
      const net =
        worked && nets.moneyAllocation === MoneyAllocation.Allocated
          ? (nets.nets[s] as SeatNet)
          : null;
      // The rebooking mark sits on the barber's first worked seat of the
      // visit only, so the REBOOKED rows count visits, as the figure does.
      let seatRebooked: boolean | null = null;
      if (worked && inBase && !rebookMarked) {
        seatRebooked = rebooked.has(visit.id);
        rebookMarked = true;
      }
      out.push({
        appointmentId: visit.id,
        seatId: seat.seatId,
        localDate: visit.localDate,
        startMinutes: seat.startMinutes,
        serviceId: seat.serviceId,
        attendanceState: seat.attendanceState,
        netCents: net === null ? PriceCents.ZERO : net.netCents,
        tipCents: net === null ? PriceCents.ZERO : net.tipCents,
        seatRebooked,
        seatLateCancelled:
          seat.attendanceState === AttendanceState.Cancelled &&
          ClientStatsSystem.clientCaused(seat) &&
          visit.bookedAtUtcMs !== null &&
          ClientStatsPolicy.isLateCancellation(
            input.policy,
            visit.utcEpochMs,
            seat.cancelledAtUtcMs,
            seat.cancellationWindowHours,
          ),
      });
    }
  }
  return out.sort(
    (a, b) =>
      (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0) ||
      a.startMinutes - b.startMinutes,
  );
}
