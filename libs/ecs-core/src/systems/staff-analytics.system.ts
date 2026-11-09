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
  type MonthKey,
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
  type AnalyticsGoal,
  AnalyticsPeriod,
  AnalyticsSpan,
  GoalPaceTag,
  HeroChange,
  type AnalyticsReport,
  BookingOrigin,
  ClientStatsPolicy,
  type DayBody,
  DayFigures,
  type DayRow,
  type MinuteRange,
  Placement,
  RadarBase,
  type Role,
  Roles,
  type RosterWindow,
  Seat,
  type ShopNow,
  StaffLink,
} from '@core/components';
import type {
  Appointment,
  BarberSchedule,
  ClientStatsRecord,
  ScheduleException,
  ShopLocation,
  User,
} from '@core/entities';
import { AnalyticsHourSystem, type HourDay } from './analytics-hour.system';
import { AnalyticsRadarSystem } from './analytics-radar.system';
import { type ChairDay, ChairTimeSystem } from './chair-time.system';
import { DayFiguresSystem } from './day-figures.system';
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
  | 'locationId'
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
 * A barber-day's parts, with the minutes a `CLOSED` day would have rostered,
 * the day's offered stretches — the rostered ranges on the wall clock (the
 * roster's offered windows, blocks and breaks at the ACTIVE shops,
 * normalized: what `rosteredMinutes` totals), which the hour grid buckets —
 * and whether the day is PAST (Terms, «Past day»: two days back at every
 * shop the barber has a stretch at on it, `isPastDay`), decided once here so
 * the fold and the report stay zone-blind. `locationIds` are the locations
 * the day touched (ADR 2026-11-09): its offered windows, blocks and
 * breaks, the roster a `CLOSED` day would have given, and every visit with
 * a seat of the barber — sorted, each once.
 */
export type AnalyticsDay = ChairDay & {
  readonly closedDayMinutes: MinuteCount;
  readonly stretches: readonly MinuteRange[];
  readonly pastDay: boolean;
  readonly locationIds: readonly LocationId[];
};

/**
 * Everything a report is computed from — read by the pipeline, nothing else
 * (`docs/designs/staff-analytics-v2.md`, `staffAnalytics`). A barber-day of
 * the period is counted ONCE, from exactly one source: its stored figures
 * (`pastDays`, a day document of this definition) when it has them, else
 * live — its cut day in `days` and its visits in `visits`. The same rule
 * holds for the comparison period over `previousPastDays` and
 * `previousVisits`; the hero's cut day (today's counterpart) is the one
 * exception, counted from its visits up to the current minute even when a
 * document holds it.
 */
export type AnalyticsInput = {
  /** The barber record reported on; `null` for the shop or a location. */
  readonly scopeBarberId: BarberId | null;
  /**
   * The location reported on (ADR 2026-11-09); `null` for the shop or a
   * barber. Every list below is already cut to it — the days by
   * {@link StaffAnalyticsSystem.atLocation}, the stored days by
   * {@link StaffAnalyticsSystem.storedAt}, the visits by
   * {@link StaffAnalyticsSystem.visitsAt} — so the report only states it.
   */
  readonly scopeLocationId: LocationId | null;
  /** The barber records in scope: the one, or every one of the shop. */
  readonly barberIds: readonly BarberId[];
  readonly period: AnalyticsPeriod;
  /** The comparison the call asked for — stated on the report as it is. */
  readonly analyticsComparison: AnalyticsComparison;
  /**
   * The scope's barber-days of the period computed LIVE (`daysOf`): the
   * live days, and the past days no current document exists for — those
   * count in `reportMissingDays`. A day listed in `pastDays` too is read
   * from its figures, never from here.
   */
  readonly days: readonly AnalyticsDay[];
  /**
   * The stored figures of the period's PAST barber-days (the day documents
   * of this definition, `DayFiguresSystem.fold` as the writer folded them);
   * empty with the flag off.
   */
  readonly pastDays: readonly DayFigures[];
  /** The scope's barber-days of the next 7 shop days from today. */
  readonly aheadDays: readonly ChairDay[];
  /** The visits of the period's live barber-days with a seat in scope, each once. */
  readonly visits: readonly AnalyticsVisit[];
  /**
   * The comparison period's visits with a seat in scope — its live
   * barber-days' and, while the period runs, the counterpart day's (the
   * hero's cut, read live however the day is held); empty (never read) when
   * the period is not comparable (`AnalyticsPeriod.isComparable`).
   */
  readonly previousVisits: readonly AnalyticsVisit[];
  /** The comparison period's stored past days, held like `pastDays`; empty when not comparable. */
  readonly previousPastDays: readonly DayFigures[];
  readonly followUps: readonly AnalyticsFollowUp[];
  /**
   * The clients first seen in the period, shop-wide (the client-stats
   * projection's records) — the report counts the scope's own.
   */
  readonly firstSeen: readonly AnalyticsFirstSeen[];
  readonly policy: ClientStatsPolicy;
  readonly now: ShopNow;
  /**
   * How the shop's locations compete — each location's figures from its
   * own report (`AnalyticsCarouselSystem.locationFiguresOf`), computed by
   * the pipeline for a shop report over two or more locations; empty
   * otherwise. The report carries it as `reportLocations`.
   */
  readonly locationFigures: readonly AnalyticsReport.LocationFigures[];
  /**
   * The scope's goal for the period's month (PR 6, «Goals») — read on a
   * `MONTH` only; `null` off `MONTH` or without one. The report hands its
   * range back and paces the takings against it ({@link StaffAnalyticsSystem.goalPaceOf}).
   */
  readonly goal: AnalyticsGoal | null;
};

/** A client's first visit as the projection records it — a `ClientStatsRecord` satisfies it as is. */
export type AnalyticsFirstSeen = Pick<
  ClientStatsRecord,
  | 'customerId'
  | 'firstVisitLocalDate'
  | 'firstVisitBarberIds'
  | 'firstVisitLocationId'
>;

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

/**
 * One choice of the admin's scope picker: the shop (both `null`), one
 * location, or a barber record — and whether it is the admin's own.
 */
export type AnalyticsScopeChoice = {
  readonly scopeBarberId: BarberId | null;
  readonly scopeLocationId: LocationId | null;
  readonly scopeMine: boolean;
};

/**
 * Everything one stored barber-day is folded from: the day's inputs as
 * `daysOf` reads them (one barber, one date), its follow-ups, the policy
 * and the writer's stamp.
 */
export type StoredDayInput = {
  readonly dayInput: AnalyticsDaysInput;
  readonly followUps: readonly AnalyticsFollowUp[];
  readonly policy: ClientStatsPolicy;
  readonly computedAtUtcMs: UtcEpochMs;
};

/** What a drill-down's rows add up to: their money (the figure's) and how many they are. */
export type AnalyticsRowsTotal = {
  readonly totalCents: PriceCents;
  readonly rowCount: number;
};

/** The base a count rate needs before it is shown as a rate (design G6) — declared with the radar's floors, which share it. */
const RATE_BASE = AnalyticsRadarSystem.RATE_BASE;

/**
 * The most visits one barber-day is read with (staff analytics v2, «Stamp
 * ordering»): the day writer's transaction queries `limit
 * VISITS_PER_BARBER_DAY + 1`, and one row over the cap is a refused read,
 * never a truncated day.
 */
const VISITS_PER_BARBER_DAY = 60;

/**
 * The most follow-ups booked from one visit — one per client of a small
 * party, and a rebooking or two: the cap a follow-up read (the analytics
 * adapter's `loadFollowUpsOf`, the day writer's transaction query) is
 * bounded at, per source visit; one row over it is a refused read.
 */
const FOLLOW_UPS_PER_VISIT = 5;

/** Whether the barber-day a visit sits on is past — looked up from the scope's days. */
type PastOf = (barberId: BarberId, localDate: LocalDate) => boolean;

/**
 * The past-day rule over the scope's days, by busy key; a barber-day the
 * scope does not list (never, through `daysOf`, which lists every barber ×
 * day) falls back to the report's clock: its window — the shop day and the
 * next — has ended before today.
 */
function pastOf(days: readonly AnalyticsDay[], today: LocalDate): PastOf {
  const past = new Map<BusyKey, boolean>();
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    past.set(BusyKey.of(day.barberId, day.localDate), day.pastDay);
  }
  return (barberId, localDate) =>
    past.get(BusyKey.of(barberId, localDate)) ??
    LocalDate.addDays(localDate, 1) < today;
}

/**
 * Which barber-days the report counts, and from where: `inScope` admits a
 * barber's stored figures; `live` admits a barber-day's cut day and seats —
 * in scope AND not held as stored figures, so a day is never counted twice.
 */
type Counting = {
  readonly inScope: (barberId: BarberId) => boolean;
  readonly live: (barberId: BarberId, localDate: LocalDate) => boolean;
};

function countingOf(
  barberIds: readonly BarberId[],
  pastDays: readonly DayFigures[],
): Counting {
  const scope = new Set<BarberId>(barberIds);
  const stored = new Set<BusyKey>();
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    stored.add(BusyKey.of(day.barberId, day.localDate));
  }
  return {
    inScope: (barberId) => scope.has(barberId),
    live: (barberId, localDate) =>
      scope.has(barberId) && !stored.has(BusyKey.of(barberId, localDate)),
  };
}

/** `counting` narrowed to one barber — a shop report's per-barber figures. */
function onlyOf(counting: Counting, barberId: BarberId): Counting {
  return {
    inScope: (id) => id === barberId,
    live: (id, localDate) => id === barberId && counting.live(id, localDate),
  };
}

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
  /** Every worked seat, its bill evaluated or not — what `dayWorkedSeatCount` and the service rows count. */
  workedSeatCount: number;
  /** Σ the worked seats' `durationMinutes` — what the service rows' `serviceMinutes` sum to. */
  serviceMinutes: MinuteCount;
};

/** A visit is never in the rebooking base — the comparison period's live visits, whose follow-ups are not read. */
const NEVER_PAST: PastOf = () => false;

/** No visit rebooked — beside {@link NEVER_PAST}, which admits none to the base. */
const NO_REBOOKED: ReadonlySet<AppointmentId> = new Set();

/**
 * The distinct barbers counted LIVE with a WORKED seat on `visit` — the
 * figures a visit earns per barber (the excluded count, the origin counts,
 * the rebooking pair) count once for each, so a stored day, which knows no
 * other barber's seats, sums to the report.
 */
function workedBarbersOf(
  visit: AnalyticsVisit,
  counting: Counting,
): ReadonlySet<BarberId> {
  const out = new Set<BarberId>();
  for (let s = 0; s < visit.seats.length; s++) {
    const seat = visit.seats[s] as Seat;
    if (
      counting.live(seat.barberId, visit.localDate) &&
      seat.attendanceState === AttendanceState.Worked
    ) {
      out.add(seat.barberId);
    }
  }
  return out;
}

/**
 * The money and count figures: the stored days' sums (`DayFigures`, the
 * same fields `DayFiguresSystem.sum` adds) plus the live days' seats under
 * the catalogue's per-visit rules — one formula per figure, held together
 * by property P1 (`sum(fold)` equals `report`).
 */
function figuresOf(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
  rebookedVisits: ReadonlySet<AppointmentId>,
  past: PastOf,
  policy: ClientStatsPolicy,
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
    workedSeatCount: 0,
    serviceMinutes: MinuteCount.ZERO,
  };
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId)) continue;
    out.takingsCents = PriceCents.add(out.takingsCents, day.dayTakingsCents);
    out.tipsCents = PriceCents.add(out.tipsCents, day.dayTipsCents);
    out.excludedVisitCount += day.dayExcludedVisitCount;
    out.rebookedCount += day.dayRebookedCount;
    out.rebookedBase += day.dayRebookedBase;
    out.noShowCount += day.dayNoShowCount;
    out.noShowBase += day.dayNoShowBase;
    out.lateCancellationCount += day.dayLateCancellationCount;
    out.workedSeatCount += day.dayWorkedSeatCount;
    for (let s = 0; s < day.dayServices.length; s++) {
      out.serviceMinutes = MinuteCount.add(
        out.serviceMinutes,
        (day.dayServices[s] as DayFigures.ServiceRow).serviceMinutes,
      );
    }
  }
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const nets = MoneyAllocationSystem.seatNets(visit);
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (!counting.live(seat.barberId, visit.localDate)) continue;
      switch (seat.attendanceState) {
        case AttendanceState.Worked: {
          out.noShowBase++;
          out.workedSeatCount++;
          out.serviceMinutes = MinuteCount.add(
            out.serviceMinutes,
            MinuteCount.fromDuration(seat.durationMinutes),
          );
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
          if (DayFiguresSystem.isLateCancellation(visit, seat, policy)) {
            out.lateCancellationCount++;
          }
          break;
        case AttendanceState.Scheduled:
          break;
      }
    }
    const workedBarbers = workedBarbersOf(visit, counting);
    if (nets.moneyAllocation === MoneyAllocation.NotEvaluated) {
      out.excludedVisitCount += workedBarbers.size;
    }
    // Rebooking: a visit counts once for each barber with a worked seat on
    // it, once that barber-day is past (its window — the shop day and the
    // next — has ended).
    for (const barberId of workedBarbers) {
      if (!past(barberId, visit.localDate)) continue;
      out.rebookedBase++;
      if (rebookedVisits.has(visit.id)) out.rebookedCount++;
    }
  }
  return out;
}

/**
 * The hero's takings over the compared days of one period: a stored day's
 * takings as held, a live day's from its seats — except the cut day (today,
 * or its counterpart), counted from its visits up to `cutMinute` whether or
 * not a document holds it.
 */
function heroTakings(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
  from: LocalDate,
  comparedDays: number,
  cutDayIndex: number | null,
  cutMinute: number,
): PriceCents {
  let sum = PriceCents.ZERO;
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    const index = LocalDate.daysBetween(from, day.localDate);
    if (index < 0 || index >= comparedDays || index === cutDayIndex) continue;
    if (!counting.inScope(day.barberId)) continue;
    sum = PriceCents.add(sum, day.dayTakingsCents);
  }
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const index = LocalDate.daysBetween(from, visit.localDate);
    if (index < 0 || index >= comparedDays) continue;
    const cut = index === cutDayIndex;
    const nets = MoneyAllocationSystem.seatNets(visit);
    if (nets.moneyAllocation !== MoneyAllocation.Allocated) continue;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (seat.attendanceState !== AttendanceState.Worked) continue;
      const counted = cut
        ? counting.inScope(seat.barberId)
        : counting.live(seat.barberId, visit.localDate);
      if (!counted) continue;
      if (cut && seatEnd(seat) > cutMinute) continue;
      sum = PriceCents.add(sum, (nets.nets[s] as SeatNet).netCents);
    }
  }
  return sum;
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

/**
 * The time parts: the live days' as `ChairTimeSystem` cut them, the stored
 * days' as held — a stored day has wholly elapsed, so its blocked, held and
 * short-gap minutes are all past ones.
 */
function timeOf(
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  counting: Counting,
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
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId)) continue;
    t.rostered += day.dayRosteredMinutes;
    t.worked += day.dayWorkedMinutes;
    t.noShow += day.dayNoShowMinutes;
    t.unmarked += day.dayUnmarkedMinutes;
    t.bookedAhead += day.dayBookedAheadMinutes;
    t.held += day.dayHeldMinutes;
    t.blocked += day.dayBlockedMinutes;
    t.breaks += day.dayBreakMinutes;
    t.shortGap += day.dayShortGapMinutes;
    t.unsold += day.dayUnsoldMinutes;
    t.open += day.dayOpenMinutes;
    t.closed += day.dayClosedDayMinutes;
    t.outside += day.dayOutsideHoursMinutes;
    t.outsideSeats += day.dayOutsideHoursSeatCount;
    t.pastBlocked += day.dayBlockedMinutes;
    t.pastHeld += day.dayHeldMinutes;
    t.pastShortGap += day.dayShortGapMinutes;
  }
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    if (!counting.live(day.barberId, day.localDate)) continue;
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
 * The longest period charted and listed day by day (a quarter); a longer
 * `CUSTOM` range is charted per ISO week and listed per month, a `YEAR`
 * charted and listed per month (design, `reportSeries`, `reportDayRows`).
 */
const DAY_GRAIN_MAX_DAYS = 93;

/** Days in an ISO week — the weekly grain's step. */
const DAYS_PER_WEEK = 7;

/** Is a period of `from … to` listed per month rather than per day — longer than {@link DAY_GRAIN_MAX_DAYS}. */
function rowsPerMonth(from: LocalDate, to: LocalDate): boolean {
  return LocalDate.daysBetween(from, to) + 1 > DAY_GRAIN_MAX_DAYS;
}

/**
 * How a period is cut into chart buckets: the first day of each, and the
 * bucket every day of the period falls in. Per day for a period of up to
 * {@link DAY_GRAIN_MAX_DAYS} days; per ISO week beyond — the first bucket
 * runs from the period's first day to the Sunday of its ISO week, every
 * later one starts on a Monday, the last ends with the period; per month
 * for a `YEAR`.
 */
type SeriesGrain = {
  readonly starts: readonly LocalDate[];
  readonly bucketOf: ReadonlyMap<LocalDate, number>;
};

function grainOf(period: AnalyticsPeriod): SeriesGrain {
  const from = period.fromLocalDate;
  const to = period.toLocalDate;
  const starts: LocalDate[] = [];
  if (period.analyticsSpan === AnalyticsSpan.Year) {
    let first = from;
    while (first <= to) {
      starts.push(first);
      first = LocalDate.addMonths(first, 1);
    }
  } else if (rowsPerMonth(from, to)) {
    starts.push(from);
    let monday = LocalDate.addDays(LocalDate.startOfWeek(from), DAYS_PER_WEEK);
    while (monday <= to) {
      starts.push(monday);
      monday = LocalDate.addDays(monday, DAYS_PER_WEEK);
    }
  } else {
    starts.push(...LocalDate.range(from, to));
  }
  const bucketOf = new Map<LocalDate, number>();
  const days = LocalDate.range(from, to);
  let bucket = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as LocalDate;
    while (
      bucket + 1 < starts.length &&
      (starts[bucket + 1] as LocalDate) <= day
    ) {
      bucket++;
    }
    bucketOf.set(day, bucket);
  }
  return { starts, bucketOf };
}

/** The bucket `localDate` falls in, `-1` outside the grain's period. */
function bucketIndexOf(grain: SeriesGrain, localDate: LocalDate): number {
  return grain.bucketOf.get(localDate) ?? -1;
}

/**
 * The net takings per bucket — the `reportTakingsCents` rule (a stored
 * day's takings as held; an allocated bill's seat nets on a live day; a
 * visit whose bill could not be evaluated adds nothing), cut by the day.
 */
function takingsByBucket(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
  grain: SeriesGrain,
): readonly PriceCents[] {
  const out: PriceCents[] = [];
  for (let i = 0; i < grain.starts.length; i++) out.push(PriceCents.ZERO);
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    const index = bucketIndexOf(grain, day.localDate);
    if (index < 0 || !counting.inScope(day.barberId)) continue;
    out[index] = PriceCents.add(out[index] as PriceCents, day.dayTakingsCents);
  }
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
        !counting.live(seat.barberId, visit.localDate)
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
  counting: Counting,
  previousCounting: Counting,
  grain: SeriesGrain,
  previous: AnalyticsPeriod | null,
): readonly AnalyticsReport.SeriesPoint[] {
  const current = takingsByBucket(
    input.visits,
    input.pastDays,
    counting,
    grain,
  );
  const compared =
    previous === null
      ? []
      : takingsByBucket(
          input.previousVisits,
          input.previousPastDays,
          previousCounting,
          grainOf(previous),
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
  pastDays: readonly DayFigures[],
  counting: Counting,
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
  const add = (
    index: number,
    worked: MinuteCount,
    noShow: MinuteCount,
    unmarked: MinuteCount,
    blocked: MinuteCount,
    unsold: MinuteCount,
    held: MinuteCount,
    shortGap: MinuteCount,
  ): void => {
    const point = out[index] as (typeof out)[number];
    point.workedMinutes = MinuteCount.add(point.workedMinutes, worked);
    point.noShowMinutes = MinuteCount.add(point.noShowMinutes, noShow);
    point.unmarkedMinutes = MinuteCount.add(point.unmarkedMinutes, unmarked);
    point.blockedMinutes = MinuteCount.add(point.blockedMinutes, blocked);
    point.unsoldMinutes = MinuteCount.add(point.unsoldMinutes, unsold);
    point.otherMinutes = MinuteCount.add(
      MinuteCount.add(point.otherMinutes, held),
      shortGap,
    );
  };
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    const index = bucketIndexOf(grain, day.localDate);
    if (index < 0 || !counting.inScope(day.barberId)) continue;
    add(
      index,
      day.dayWorkedMinutes,
      day.dayNoShowMinutes,
      day.dayUnmarkedMinutes,
      day.dayBlockedMinutes,
      day.dayUnsoldMinutes,
      day.dayHeldMinutes,
      day.dayShortGapMinutes,
    );
  }
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    const index = bucketIndexOf(grain, day.localDate);
    if (index < 0 || !counting.live(day.barberId, day.localDate)) continue;
    add(
      index,
      day.workedMinutes,
      day.noShowMinutes,
      day.unmarkedMinutes,
      day.pastBlockedMinutes,
      day.unsoldMinutes,
      day.pastHeldMinutes,
      day.pastShortGapMinutes,
    );
  }
  return out;
}

/**
 * Each counted barber-day's hour buckets: a stored day's as held; a live
 * day's from its offered stretches and the chair time of its WORKED seats
 * (a wholly cancelled visit holds no chair, as `ChairTimeSystem` reads it).
 * A live day with neither is skipped — it has no cell to add to.
 */
function hourDaysOf(
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  visits: readonly AnalyticsVisit[],
  counting: Counting,
): readonly HourDay[] {
  const out: HourDay[] = [];
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId)) continue;
    out.push({
      localDate: day.localDate,
      worked: day.dayHourWorked,
      rostered: day.dayHourRostered,
    });
  }
  const seatsOn = new Map<BusyKey, MinuteRange[]>();
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    if (visit.bookingStatus === BookingStatus.Cancelled) continue;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !counting.live(seat.barberId, visit.localDate)
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
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (!counting.live(day.barberId, day.localDate)) continue;
    const seats = seatsOn.get(BusyKey.of(day.barberId, day.localDate));
    if (day.stretches.length === 0 && seats === undefined) continue;
    out.push(
      AnalyticsHourSystem.bucketsOf(day.localDate, seats ?? [], day.stretches),
    );
  }
  return out;
}

/**
 * The distinct shop days of the period that roster any minute in scope —
 * a day with a stretch, counted from its stored figures or its live fold.
 * On the shop scope a day counts ONCE when any barber has a stretch on it.
 */
function rosteredDatesOf(
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  counting: Counting,
): ReadonlySet<LocalDate> {
  const dates = new Set<LocalDate>();
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (counting.inScope(day.barberId) && day.dayRosteredMinutes > 0) {
      dates.add(day.localDate);
    }
  }
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (counting.live(day.barberId, day.localDate) && day.rosteredMinutes > 0) {
      dates.add(day.localDate);
    }
  }
  return dates;
}

/** How many distinct shop days of the period roster any minute in scope — the heatmap sentence's base. */
function rosteredDayCountOf(
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  counting: Counting,
): number {
  return rosteredDatesOf(days, pastDays, counting).size;
}

/** The goal formula's two day counts: the rostered days up to and including `today`, and all of them. */
type GoalDays = {
  readonly daysWorkedSoFar: number;
  readonly daysRosteredInMonth: number;
};

/** What a report off `MONTH` carries — no days, so the pace is `NONE`. */
const NO_GOAL_DAYS: GoalDays = { daysWorkedSoFar: 0, daysRosteredInMonth: 0 };

/** The goal formula's counts over the month's rostered dates (PR 6): `daysWorkedSoFar` ≤ today, `daysRosteredInMonth` all. */
function goalDaysOf(dates: ReadonlySet<LocalDate>, today: LocalDate): GoalDays {
  let soFar = 0;
  for (const date of dates) if (date <= today) soFar++;
  return { daysWorkedSoFar: soFar, daysRosteredInMonth: dates.size };
}

/** The past barber-days in scope computed live — no current document held them. */
function missingDaysOf(
  days: readonly AnalyticsDay[],
  counting: Counting,
): number {
  let count = 0;
  for (let d = 0; d < days.length; d++) {
    const day = days[d] as AnalyticsDay;
    if (day.pastDay && counting.live(day.barberId, day.localDate)) count++;
  }
  return count;
}

/** Whether any counted barber-day of the comparison period holds a WORKED seat in scope — else there was no previous period to compare with. */
function hadWorkedSeat(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
): boolean {
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (counting.inScope(day.barberId) && day.dayWorkedSeatCount > 0) {
      return true;
    }
  }
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        counting.inScope(seat.barberId) &&
        seat.attendanceState === AttendanceState.Worked
      ) {
        return true;
      }
    }
  }
  return false;
}

/** The minutes `input`'s day would roster — its windows, blocks and breaks, normalized. */
function offeredOf(input: BuildDayWindowsInput): readonly RosterWindow[] {
  return [
    ...RosterSystem.offeredWindows(input),
    ...RosterSystem.offeredCarveOuts(input),
    ...RosterSystem.offeredBreaks(input),
  ];
}

/**
 * The locations a barber-day touched: those of its stretches (offered, or
 * what a `CLOSED` day would have offered) and of every visit with a seat of
 * the barber — sorted, each once.
 */
function touchedOf(
  stretches: readonly RosterWindow[],
  visits: readonly AnalyticsVisit[] | undefined,
  barberId: BarberId,
): readonly LocationId[] {
  const ids = new Set<LocationId>();
  for (let i = 0; i < stretches.length; i++) {
    ids.add((stretches[i] as RosterWindow).locationId);
  }
  if (visits !== undefined) {
    for (let v = 0; v < visits.length; v++) {
      const visit = visits[v] as AnalyticsVisit;
      for (let s = 0; s < visit.seats.length; s++) {
        if ((visit.seats[s] as Seat).barberId === barberId) {
          ids.add(visit.locationId);
          break;
        }
      }
    }
  }
  return [...ids].sort();
}

/** One shop's clock among those read, else the report's own. */
function clockOf(
  locationId: LocationId,
  nowByLocation: readonly ShopNowAt[],
  fallback: ShopNow,
): ShopNow {
  for (let i = 0; i < nowByLocation.length; i++) {
    const at = nowByLocation[i] as ShopNowAt;
    if (at.locationId === locationId) return at;
  }
  return fallback;
}

/** The clock of the shop the day is worked at — its first offered stretch's — else the report's. */
function nowOf(
  stretches: readonly { readonly locationId: LocationId }[],
  nowByLocation: readonly ShopNowAt[],
  fallback: ShopNow,
): ShopNow {
  const first = stretches[0];
  if (first === undefined) return fallback;
  return clockOf(first.locationId, nowByLocation, fallback);
}

/**
 * STAFF ANALYTICS (`docs/designs/staff-analytics.md`, catalogue v1;
 * `docs/designs/staff-analytics-v2.md`) — the visibility table and the
 * report, every value decided here so a presenter only words it (Law 10).
 * A past day is read from its stored figures when a document holds them
 * and computed live otherwise; one formula per figure, whichever the source.
 */
export const StaffAnalyticsSystem = {
  RATE_BASE,
  VISITS_PER_BARBER_DAY,
  FOLLOW_UPS_PER_VISIT,
  AHEAD_DAYS,
  DAY_GRAIN_MAX_DAYS,

  /**
   * Is the barber-day `localDate` PAST (staff analytics v2, Terms «Past
   * day»): `localDate + 1 < today` on the clock of EVERY shop the barber has
   * a stretch at on it — two days back, so the rebooking window (a
   * follow-up booked by the end of the next day) has closed everywhere the
   * day was worked. With no stretch at any shop, past is judged on `now`,
   * the default shop's clock. A shop whose clock was not read reads as
   * `now` too.
   */
  isPastDay(
    localDate: LocalDate,
    nowByLocation: readonly ShopNowAt[],
    stretches: readonly { readonly locationId: LocationId }[],
    now: ShopNow,
  ): boolean {
    const next = LocalDate.addDays(localDate, 1);
    if (stretches.length === 0) return next < now.localDate;
    for (let i = 0; i < stretches.length; i++) {
      const stretch = stretches[i] as { readonly locationId: LocationId };
      const clock = clockOf(stretch.locationId, nowByLocation, now);
      if (!(next < clock.localDate)) return false;
    }
    return true;
  },

  /**
   * The first day of each bucket the charts cut `period` into
   * (`reportSeries`, `reportTimeSeries`): every day for a period of up to
   * {@link DAY_GRAIN_MAX_DAYS} days; beyond that the period's first day and
   * then every Monday inside it — a partial first or last ISO week is a
   * bucket of its own; for a `YEAR` the first day of each month.
   */
  seriesStartsOf(period: AnalyticsPeriod): readonly LocalDate[] {
    return grainOf(period).starts;
  },

  /**
   * Whether `report`'s day rows are per month rather than per barber-day —
   * a period longer than {@link DAY_GRAIN_MAX_DAYS} days (a `YEAR`, a
   * `CUSTOM` range over a quarter): the presenter titles such a row by its
   * month and lets it open the `MONTH` span, and never re-derives the rule.
   */
  dayRowsAreMonths(report: AnalyticsReport): boolean {
    return rowsPerMonth(report.reportFromLocalDate, report.reportToLocalDate);
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
   * The busy keys of the barber-days computed LIVE — every `barberIds` ×
   * `localDates` key no stored day in `stored` (`currentStoredOf`) holds,
   * barber by barber: the keys the pipeline reads visits by; the past days
   * among them are `reportMissingDays`.
   */
  liveKeysOf(
    barberIds: readonly BarberId[],
    localDates: readonly LocalDate[],
    stored: readonly DayFigures[],
  ): readonly BusyKey[] {
    const held = new Set<BusyKey>();
    for (let i = 0; i < stored.length; i++) {
      const day = stored[i] as DayFigures;
      held.add(BusyKey.of(day.barberId, day.localDate));
    }
    const out: BusyKey[] = [];
    for (let b = 0; b < barberIds.length; b++) {
      for (let d = 0; d < localDates.length; d++) {
        const key = BusyKey.of(
          barberIds[b] as BarberId,
          localDates[d] as LocalDate,
        );
        if (!held.has(key)) out.push(key);
      }
    }
    return out;
  },

  /**
   * The stored days the report counts: those of `stored` folded under THIS
   * definition (`dayDefinitionVersion`) — a document of an older definition
   * is version-stale and left to the live path, as the design's `staffAnalytics`
   * step 3 rules, until the recompute rewrites it.
   */
  currentStoredOf<D extends DayFigures>(stored: readonly D[]): readonly D[] {
    const out: D[] = [];
    for (let i = 0; i < stored.length; i++) {
      const day = stored[i] as D;
      if (day.dayDefinitionVersion === ANALYTICS_DEFINITION_VERSION) {
        out.push(day);
      }
    }
    return out;
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
    const visitsOn = new Map<LocalDate, AnalyticsVisit[]>();
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
        // What a CLOSED day would have offered without its departure.
        const wouldOffer = closed
          ? offeredOf({
              ...day,
              exceptions: exceptions.filter(
                (exception) => exception.localDate !== localDate,
              ),
            })
          : [];
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
          pastDay: StaffAnalyticsSystem.isPastDay(
            localDate,
            input.nowByLocation,
            [...windows, ...blocks, ...breaks],
            input.now,
          ),
          closedDayMinutes: closed
            ? IntervalSetSystem.totalMinutes(
                IntervalSetSystem.normalize(wouldOffer),
              )
            : MinuteCount.ZERO,
          locationIds: touchedOf(
            [...windows, ...blocks, ...breaks, ...wouldOffer],
            visitsOn.get(localDate),
            barberId,
          ),
        });
      }
    }
    return days;
  },

  /**
   * A scope's days cut to one location (ADR 2026-11-09): only that shop's
   * hours — the roster offers nothing at a shop it is not given
   * (`RosterSystem.offeredWindows`) — and only the visits booked there.
   * `null` is every location: the input as it is.
   */
  atLocation(
    input: AnalyticsDaysInput,
    locationId: LocationId | null,
  ): AnalyticsDaysInput {
    if (locationId === null) return input;
    const locations: ShopLocation[] = [];
    for (let i = 0; i < input.locations.length; i++) {
      const location = input.locations[i] as ShopLocation;
      if (location.id === locationId) locations.push(location);
    }
    return {
      ...input,
      locations,
      visits: StaffAnalyticsSystem.visitsAt(input.visits, locationId),
    };
  },

  /**
   * Whether a request's report carries the shop's location comparison: the
   * shop itself (no barber, no location) over two or more locations.
   */
  comparesLocations(
    scopeBarberId: BarberId | null,
    scopeLocationId: LocationId | null,
    locationCount: number,
  ): boolean {
    return (
      scopeBarberId === null && scopeLocationId === null && locationCount > 1
    );
  },

  /** The visits booked at `locationId`; `null` keeps every one. */
  visitsAt<V extends { readonly locationId: LocationId }>(
    visits: readonly V[],
    locationId: LocationId | null,
  ): readonly V[] {
    if (locationId === null) return visits;
    const out: V[] = [];
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as V;
      if (visit.locationId === locationId) out.push(visit);
    }
    return out;
  },

  /**
   * The stored days as one location's figures (`DayFigures.atLocation`):
   * one per stored day, so every day stays held — a day that never touched
   * the location answers an empty one. `null` keeps the days as they are.
   */
  storedAt<D extends DayFigures>(
    days: readonly D[],
    locationId: LocationId | null,
  ): readonly DayFigures[] {
    if (locationId === null) return days;
    const out: DayFigures[] = [];
    for (let i = 0; i < days.length; i++) {
      out.push(DayFigures.atLocation(days[i] as D, locationId));
    }
    return out;
  },

  /**
   * ONE STORED BARBER-DAY (the writer's fold): the day's figures over every
   * location, the locations it touched, and — when it touched two or more —
   * each one's share, folded from the day cut to that location
   * ({@link atLocation}), so a stored share and a live location day are
   * spelt by one rule. `input.dayInput` names one barber and one date.
   */
  storedDayOf(input: StoredDayInput): DayFigures {
    const day = StaffAnalyticsSystem.daysOf(input.dayInput)[0] as AnalyticsDay;
    const shares: DayBody[] = [];
    if (day.locationIds.length > 1) {
      for (let i = 0; i < day.locationIds.length; i++) {
        const cut = StaffAnalyticsSystem.atLocation(
          input.dayInput,
          day.locationIds[i] as LocationId,
        );
        shares.push(
          DayFiguresSystem.body({
            day: StaffAnalyticsSystem.daysOf(cut)[0] as AnalyticsDay,
            visits: cut.visits,
            followUps: input.followUps,
            policy: input.policy,
          }),
        );
      }
    }
    return DayFiguresSystem.fold({
      day,
      visits: input.dayInput.visits,
      followUps: input.followUps,
      policy: input.policy,
      computedAtUtcMs: input.computedAtUtcMs,
      locationShares: shares,
    });
  },

  /**
   * THE NEW CLIENTS of a scope's period: the clients whose first worked
   * visit at the shop fell in it — with `scopeBarberId` when the scope is a
   * barber, at `scopeLocationId` when it is a location, anywhere for the
   * shop. Each record is one client, so a client counts once.
   */
  newClientCountOf(
    firstSeen: readonly AnalyticsFirstSeen[],
    scopeBarberId: BarberId | null,
    scopeLocationId: LocationId | null,
    period: AnalyticsPeriod,
  ): number {
    let count = 0;
    for (let i = 0; i < firstSeen.length; i++) {
      const record = firstSeen[i] as AnalyticsFirstSeen;
      const day = record.firstVisitLocalDate;
      if (
        day === null ||
        day < period.fromLocalDate ||
        day > period.toLocalDate
      ) {
        continue;
      }
      if (
        scopeBarberId !== null &&
        !record.firstVisitBarberIds.includes(scopeBarberId)
      ) {
        continue;
      }
      if (
        scopeLocationId !== null &&
        record.firstVisitLocationId !== scopeLocationId
      ) {
        continue;
      }
      count++;
    }
    return count;
  },

  /**
   * THE LOCATION SCOPE (ADR 2026-11-09), beside {@link scopeOf}: `null`
   * (the whole shop, or the barber `scopeOf` answered) unless the request
   * names a location. Only an admin may, never beside a barber, and only a
   * location of the shop's.
   */
  locationScopeOf(
    caller: AnalyticsCaller,
    request: {
      readonly scopeBarberId: BarberId | null;
      readonly scopeLocationId: LocationId | null;
    },
    locations: readonly ShopLocation[],
  ): Result<LocationId | null, AnalyticsError> {
    const locationId = request.scopeLocationId;
    if (locationId === null) return Result.ok(null);
    if (request.scopeBarberId !== null) {
      return Result.err(AnalyticsError.invalidInput('scopeLocationId'));
    }
    const isAdmin =
      !caller.callerBlocked &&
      caller.callerRoles.some((role) =>
        (Roles.ANALYTICS_SHOP as readonly Role[]).includes(role),
      );
    if (!isAdmin) return Result.err(AnalyticsError.forbidden());
    for (let i = 0; i < locations.length; i++) {
      if ((locations[i] as ShopLocation).id === locationId) {
        return Result.ok(locationId);
      }
    }
    return Result.err(AnalyticsError.locationUnknown(locationId));
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
    request: { readonly scopeBarberId: BarberId | null },
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
    // Which barber-days are held as stored figures — the period's and the
    // comparison period's each on their own side.
    const counting = countingOf(input.barberIds, input.pastDays);
    const previousCounting = countingOf(
      input.barberIds,
      input.previousPastDays,
    );
    const today = input.now.localDate;
    const past = pastOf(input.days, today);
    const rebooked = DayFiguresSystem.rebookedVisits(
      input.visits,
      input.followUps,
    );
    const figures = figuresOf(
      input.visits,
      input.pastDays,
      counting,
      rebooked,
      past,
      input.policy,
    );
    const time = timeOf(input.days, input.pastDays, counting);

    // The hero: the compared days of this period against the comparison
    // period's — the same elapsed days, the counterpart day (a DAY's whole
    // comparison) cut at the current minute while the period runs. No
    // comparison at all when the period is not comparable (its comparison
    // period would start before the reach).
    const period = input.period;
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
      input.pastDays,
      counting,
      period.fromLocalDate,
      compared,
      cutIndex,
      input.now.currentMinute,
    );
    const hadPrevious =
      previous !== null &&
      hadWorkedSeat(
        input.previousVisits,
        input.previousPastDays,
        previousCounting,
      );
    const previousCompared =
      previous === null
        ? 0
        : Math.min(compared, AnalyticsPeriod.length(previous));
    const heroPrevious =
      previous !== null && hadPrevious
        ? heroTakings(
            input.previousVisits,
            input.previousPastDays,
            previousCounting,
            previous.fromLocalDate,
            previousCompared,
            cutIndex !== null && cutIndex < previousCompared ? cutIndex : null,
            input.now.currentMinute,
          )
        : null;

    // The charts: the period cut into buckets, the hour grid and its peaks.
    const grain = grainOf(period);
    const hourGrid = AnalyticsHourSystem.grid(
      hourDaysOf(input.days, input.pastDays, input.visits, counting),
    );
    const rosteredDates = rosteredDatesOf(input.days, input.pastDays, counting);
    const peaks = AnalyticsHourSystem.peak(hourGrid, rosteredDates.size);

    // The month's goal and its pace (PR 6) — on a MONTH only.
    const onMonth = period.analyticsSpan === AnalyticsSpan.Month;
    const goal = onMonth ? input.goal : null;
    const goalDays = onMonth ? goalDaysOf(rosteredDates, today) : NO_GOAL_DAYS;

    // The shop's barbers, this period's and the comparison's, and the admin's
    // radar over them on a MONTH, YEAR or CUSTOM span; a barber's report
    // carries none of the three.
    const shop = input.scopeBarberId === null;
    const barbers = shop ? barbersOf(input, rebooked, past, counting) : [];
    const comparisonBarbers =
      shop && previous !== null
        ? comparisonBarbersOf(input, previousCounting)
        : [];
    const radars =
      shop && carriesRadar(period.analyticsSpan)
        ? AnalyticsRadarSystem.radarsOf(barbers, comparisonBarbers)
        : { reportRadars: [], reportRadarBase: RadarBase.TooFewBarbers };

    return {
      reportDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      reportComputedAtUtcMs: input.now.utcEpochMs,
      reportScopeBarberId: input.scopeBarberId,
      reportScopeLocationId: input.scopeLocationId,
      reportAnalyticsSpan: period.analyticsSpan,
      reportFromLocalDate: period.fromLocalDate,
      reportToLocalDate: period.toLocalDate,
      reportAnalyticsComparison: input.analyticsComparison,
      reportComparisonFromLocalDate:
        previous === null ? null : previous.fromLocalDate,
      reportComparisonToLocalDate:
        previous === null ? null : previous.toLocalDate,
      reportMissingDays: missingDaysOf(input.days, counting),

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
      reportNewClientCount: StaffAnalyticsSystem.newClientCountOf(
        input.firstSeen,
        input.scopeBarberId,
        input.scopeLocationId,
        period,
      ),
      reportNoShowRate: rateOf(figures.noShowCount, figures.noShowBase),
      reportLateCancellationCount: figures.lateCancellationCount,

      ...bookableOf(input.aheadDays, counting, today),

      reportBusiestWeekday:
        peaks.busiest === null ? null : peaks.busiest.weekday,
      reportBusiestHour: peaks.busiest === null ? null : peaks.busiest.hour,
      reportEmptiestWeekday:
        peaks.emptiest === null ? null : peaks.emptiest.weekday,
      reportEmptiestHour: peaks.emptiest === null ? null : peaks.emptiest.hour,

      reportSeries: seriesOf(
        input,
        counting,
        previousCounting,
        grain,
        previous,
      ),
      reportTimeSeries: timeSeriesOf(
        input.days,
        input.pastDays,
        counting,
        grain,
      ),
      reportHourGrid: hourGrid,

      reportServices: servicesOf(input.visits, input.pastDays, counting),
      reportWeekdayFill: weekdayFillOf(
        input.days,
        input.pastDays,
        counting,
        today,
      ),
      reportOrigins: originsOf(input.visits, input.pastDays, counting),
      reportBarbers: barbers,
      reportComparisonBarbers: comparisonBarbers,
      reportLocations: input.locationFigures,
      reportRadars: radars.reportRadars,
      reportRadarBase: radars.reportRadarBase,
      reportDayRows: dayRowsOf(input, counting),
      reportSeatRows:
        input.scopeBarberId === null
          ? []
          : seatRowsOf(input, rebooked, past, input.scopeBarberId, counting),

      reportGoalLowCents: goal === null ? null : goal.goalLowCents,
      reportGoalHighCents: goal === null ? null : goal.goalHighCents,
      reportGoalPaceTag: StaffAnalyticsSystem.goalPaceOf(
        figures.takingsCents,
        goal,
        goalDays.daysWorkedSoFar,
        goalDays.daysRosteredInMonth,
      ),
      reportGoalDaysSoFar: goalDays.daysWorkedSoFar,
      reportGoalDaysInMonth: goalDays.daysRosteredInMonth,
    };
  },

  /**
   * Where the month's takings stand against its goal (PR 6, the contract's
   * formula): `expectedLow/High = goalLow/High × daysWorkedSoFar ÷
   * daysRosteredInMonth` — the days with a stretch up to and including
   * today over the month's; takings at or over the expected high are
   * `AHEAD`, at or over the expected low `ON_TRACK`, under it `BEHIND`.
   * `NONE` without a goal, and before the first rostered day is worked
   * (`daysWorkedSoFar` 0 — nothing to pace yet; a report off `MONTH` hands
   * no goal and no days). Integer cents compared against a rational
   * expectation — no rounding decides a boundary.
   */
  goalPaceOf(
    takingsCents: PriceCents,
    goal: AnalyticsGoal | null,
    daysWorkedSoFar: number,
    daysRosteredInMonth: number,
  ): GoalPaceTag {
    if (goal === null || daysWorkedSoFar <= 0 || daysRosteredInMonth <= 0) {
      return GoalPaceTag.None;
    }
    // `takings ≥ goal × soFar ÷ all` ⇔ `takings × all ≥ goal × soFar` — exact in integers.
    const scaled = takingsCents * daysRosteredInMonth;
    if (scaled >= goal.goalHighCents * daysWorkedSoFar)
      return GoalPaceTag.Ahead;
    if (scaled >= goal.goalLowCents * daysWorkedSoFar) {
      return GoalPaceTag.OnTrack;
    }
    return GoalPaceTag.Behind;
  },

  /**
   * The months a goal may be set for (PR 6, «Goals»): the current month or
   * the next one on the shop's clock — `today`'s month and the month after
   * it. The pipeline refuses every other month (`ANALYTICS_GOAL_INVALID_RANGE`
   * on `goalMonth`); the screen offers «Задай цел» by the same rule.
   */
  goalMonthAllowed(month: MonthKey, today: LocalDate): boolean {
    const first = LocalDate.startOfMonth(today);
    return (
      month === LocalDate.monthKey(first) ||
      month === LocalDate.monthKey(LocalDate.addMonths(first, 1))
    );
  },

  /**
   * Whether the screen offers «Задай цел» on `period`: a `MONTH` whose
   * month {@link goalMonthAllowed} admits — the current or the next. Never
   * on another span, and never on a past or farther month.
   */
  goalMonthOffered(period: AnalyticsPeriod, today: LocalDate): boolean {
    return (
      period.analyticsSpan === AnalyticsSpan.Month &&
      StaffAnalyticsSystem.goalMonthAllowed(
        LocalDate.monthKey(period.fromLocalDate),
        today,
      )
    );
  },

  /**
   * Whether the account linked to `linkedBarberId` may set `scopeBarberId`'s
   * goal: the shop's (`null`), or its own record's — a barber record's goal
   * is that barber's alone, so an admin on a colleague's scope reads it and
   * sets none. `setAnalyticsGoal` refuses by this rule
   * (`ANALYTICS_GOAL_FORBIDDEN`) and the screen offers «Задай цел» by it.
   */
  goalScopeAllowed(
    scopeBarberId: BarberId | null,
    linkedBarberId: BarberId | null,
    scopeLocationId: LocationId | null,
  ): boolean {
    // A goal is the shop's or a barber's; a location has none (ADR 2026-11-09, L5).
    if (scopeLocationId !== null) return false;
    return scopeBarberId === null || scopeBarberId === linkedBarberId;
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
  ): readonly DayRow[] {
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
   * caller is»): the shop first — an admin opens on it — then each location
   * when there are two or more (ADR 2026-11-09, L4: with one, it IS the
   * shop), then the admin's own linked record («Аз»), then every other
   * record as listed.
   */
  scopeChoicesOf(
    barberIds: readonly BarberId[],
    linkedBarberId: BarberId | null,
    locationIds: readonly LocationId[],
  ): readonly AnalyticsScopeChoice[] {
    const out: AnalyticsScopeChoice[] = [
      { scopeBarberId: null, scopeLocationId: null, scopeMine: false },
    ];
    if (locationIds.length > 1) {
      for (let i = 0; i < locationIds.length; i++) {
        out.push({
          scopeBarberId: null,
          scopeLocationId: locationIds[i] as LocationId,
          scopeMine: false,
        });
      }
    }
    if (linkedBarberId !== null) {
      out.push({
        scopeBarberId: linkedBarberId,
        scopeLocationId: null,
        scopeMine: true,
      });
    }
    for (let i = 0; i < barberIds.length; i++) {
      const barberId = barberIds[i] as BarberId;
      if (barberId !== linkedBarberId) {
        out.push({
          scopeBarberId: barberId,
          scopeLocationId: null,
          scopeMine: false,
        });
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
   * The period before and after `period` of its span — the week, month or
   * year before and after, the day before and after (a `DAY` steps by one
   * day; its COMPARISON is a week back, `AnalyticsPeriod.previous`), a
   * `CUSTOM` range shifted by its own length either way — each only when it
   * may be asked for on `today` (`AnalyticsPeriod.isWithinRange`: back no
   * further than the reach, forward never starting past today): the
   * switcher never offers what the callable refuses.
   */
  stepsOf(period: AnalyticsPeriod, today: LocalDate): AnalyticsSteps {
    const custom = period.analyticsSpan === AnalyticsSpan.Custom;
    const previous = custom
      ? AnalyticsPeriod.previous(period)
      : AnalyticsPeriod.holding(
          period.analyticsSpan,
          LocalDate.addDays(period.fromLocalDate, -1),
        );
    const after = LocalDate.addDays(period.toLocalDate, 1);
    const next = custom
      ? AnalyticsPeriod.customOf(
          after,
          LocalDate.addDays(after, AnalyticsPeriod.length(period) - 1),
        )
      : AnalyticsPeriod.holding(period.analyticsSpan, after);
    return {
      previous: AnalyticsPeriod.isWithinRange(previous, today)
        ? previous
        : null,
      next: AnalyticsPeriod.isWithinRange(next, today) ? next : null,
    };
  },

  /**
   * The period of `span` a switch from `period` lands on (design, The
   * callable v2 contract). To a `DAY`: today when `period` holds it, else
   * `period`'s first day. To a `YEAR`: the year holding `period`'s first
   * day. From a `YEAR` to a `WEEK` or a `MONTH`: the one holding the year's
   * first day. Otherwise to a `WEEK` or a `MONTH`: the one holding `period`'s
   * last day, or today when that is later — so a past month switches to its
   * last week, the current one to this week, a day to the week or month
   * holding it. The span's current period when the one landed on is out of
   * reach. To `CUSTOM` the period stays as it is: the range sheet opens and
   * the period changes only on «Приложи» (the store's job).
   */
  periodInSpan(
    period: AnalyticsPeriod,
    span: AnalyticsSpan,
    today: LocalDate,
  ): AnalyticsPeriod {
    if (span === period.analyticsSpan || span === AnalyticsSpan.Custom) {
      return period;
    }
    const running =
      period.fromLocalDate <= today && today <= period.toLocalDate;
    const day =
      span === AnalyticsSpan.Day
        ? running
          ? today
          : period.fromLocalDate
        : span === AnalyticsSpan.Year ||
            period.analyticsSpan === AnalyticsSpan.Year
          ? period.fromLocalDate
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
  counting: Counting,
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
    if (!counting.inScope(day.barberId)) continue;
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

/** A service row under construction — mutable inside one call only. */
type ServiceTotals = { count: number; takings: PriceCents; minutes: number };

/**
 * The worked seats by service: a stored day's rows as held, a live day's
 * seats as the fold would count them; the takings per hour of service
 * derived here, never stored. Most takings first; a tie by service id, so
 * the order is stable.
 */
function servicesOf(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
): readonly AnalyticsReport.ServiceRow[] {
  const rows = new Map<ServiceId, ServiceTotals>();
  const add = (
    serviceId: ServiceId,
    count: number,
    takings: PriceCents,
    serviceMinutes: number,
  ): void => {
    const row = rows.get(serviceId);
    if (row === undefined) {
      rows.set(serviceId, { count, takings, minutes: serviceMinutes });
    } else {
      row.count += count;
      row.takings = PriceCents.add(row.takings, takings);
      row.minutes += serviceMinutes;
    }
  };
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId)) continue;
    for (let s = 0; s < day.dayServices.length; s++) {
      const row = day.dayServices[s] as DayFigures.ServiceRow;
      add(
        row.serviceId,
        row.workedSeatCount,
        row.takingsCents,
        row.serviceMinutes,
      );
    }
  }
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const nets = MoneyAllocationSystem.seatNets(visit);
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !counting.live(seat.barberId, visit.localDate)
      ) {
        continue;
      }
      add(
        seat.serviceId,
        1,
        nets.moneyAllocation === MoneyAllocation.Allocated
          ? (nets.nets[s] as SeatNet).netCents
          : PriceCents.ZERO,
        seat.durationMinutes,
      );
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
  return out.sort(
    (a, b) =>
      b.takingsCents - a.takingsCents ||
      (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0),
  );
}

/** Fill by weekday over the period's days before today: (worked + no-show + unmarked) ÷ (rostered − break). */
function weekdayFillOf(
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  counting: Counting,
  today: LocalDate,
): readonly AnalyticsReport.WeekdayFill[] {
  const byWeekday = new Map<Weekday, { filled: number; capacity: number }>();
  const add = (
    localDate: LocalDate,
    filled: number,
    capacity: number,
  ): void => {
    const weekday = LocalDate.weekday(localDate);
    const entry = byWeekday.get(weekday) ?? { filled: 0, capacity: 0 };
    entry.filled += filled;
    entry.capacity += capacity;
    byWeekday.set(weekday, entry);
  };
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId) || day.localDate >= today) continue;
    add(
      day.localDate,
      day.dayWorkedMinutes + day.dayNoShowMinutes + day.dayUnmarkedMinutes,
      day.dayRosteredMinutes - day.dayBreakMinutes,
    );
  }
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as AnalyticsDay;
    if (!counting.live(day.barberId, day.localDate) || day.localDate >= today) {
      continue;
    }
    add(
      day.localDate,
      day.workedMinutes + day.noShowMinutes + day.unmarkedMinutes,
      day.rosteredMinutes - day.breakMinutes,
    );
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

/**
 * Visits by where they were booked — a stored day's counts as held; a live
 * visit counted once per barber in scope with a worked seat on it
 * (`workedBarbersOf`), so a shop's shares are the sum of its barbers' and
 * of its stored days'.
 */
function originsOf(
  visits: readonly AnalyticsVisit[],
  pastDays: readonly DayFigures[],
  counting: Counting,
): readonly AnalyticsReport.OriginShare[] {
  let online = 0;
  let staff = 0;
  let unknown = 0;
  for (let i = 0; i < pastDays.length; i++) {
    const day = pastDays[i] as DayFigures;
    if (!counting.inScope(day.barberId)) continue;
    online += day.dayOnlineVisitCount;
    staff += day.dayStaffVisitCount;
    unknown += day.dayUnknownOriginVisitCount;
  }
  for (let v = 0; v < visits.length; v++) {
    const visit = visits[v] as AnalyticsVisit;
    const counts = workedBarbersOf(visit, counting).size;
    if (counts === 0) continue;
    if (visit.placement === Placement.Self) online += counts;
    else if (visit.placement === Placement.Staff) staff += counts;
    else unknown += counts;
  }
  return [
    { bookingOrigin: BookingOrigin.Online, visitCount: online },
    { bookingOrigin: BookingOrigin.Staff, visitCount: staff },
    { bookingOrigin: BookingOrigin.Unknown, visitCount: unknown },
  ];
}

/** One barber's figures over one period's sources — the per-barber rows of a shop report, this period's and the comparison's. */
function barberFiguresOf(
  barberId: BarberId,
  visits: readonly AnalyticsVisit[],
  days: readonly AnalyticsDay[],
  pastDays: readonly DayFigures[],
  counting: Counting,
  rebooked: ReadonlySet<AppointmentId>,
  past: PastOf,
  policy: ClientStatsPolicy,
): AnalyticsReport.BarberFigures {
  const only = onlyOf(counting, barberId);
  const figures = figuresOf(visits, pastDays, only, rebooked, past, policy);
  const time = timeOf(days, pastDays, only);
  return {
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
    serviceMinutes: figures.serviceMinutes,
    workedSeatCount: figures.workedSeatCount,
    rosteredDayCount: rosteredDayCountOf(days, pastDays, only),
  };
}

function barbersOf(
  input: AnalyticsInput,
  rebooked: ReadonlySet<AppointmentId>,
  past: PastOf,
  counting: Counting,
): readonly AnalyticsReport.BarberFigures[] {
  const out: AnalyticsReport.BarberFigures[] = [];
  for (let b = 0; b < input.barberIds.length; b++) {
    out.push(
      barberFiguresOf(
        input.barberIds[b] as BarberId,
        input.visits,
        input.days,
        input.pastDays,
        counting,
        rebooked,
        past,
        input.policy,
      ),
    );
  }
  return out;
}

/**
 * The comparison period's figures per barber (the radars' grey outline),
 * from what the pipeline reads of it: its stored days and its live visits
 * (`previousPastDays`, `previousVisits`). No cut day and no follow-up is
 * read for it, so its time parts and rostered days are the stored days'
 * alone — a live comparison day adds no minutes — and its rebooking pair is
 * the stored days' alone: a live visit enters no base ({@link NEVER_PAST}).
 * Its money, worked seats, service minutes and the other counts come from
 * both sources, as this period's do.
 */
function comparisonBarbersOf(
  input: AnalyticsInput,
  previousCounting: Counting,
): readonly AnalyticsReport.BarberFigures[] {
  const out: AnalyticsReport.BarberFigures[] = [];
  for (let b = 0; b < input.barberIds.length; b++) {
    out.push(
      barberFiguresOf(
        input.barberIds[b] as BarberId,
        input.previousVisits,
        [],
        input.previousPastDays,
        previousCounting,
        NO_REBOOKED,
        NEVER_PAST,
        input.policy,
      ),
    );
  }
  return out;
}

/** Whether a span carries the admin's radar — a `MONTH`, a `YEAR` or a `CUSTOM` range (design, «The admin's radar»). */
function carriesRadar(span: AnalyticsSpan): boolean {
  return (
    span === AnalyticsSpan.Month ||
    span === AnalyticsSpan.Year ||
    span === AnalyticsSpan.Custom
  );
}

/** Date, then barber — the order the day rows are listed in. */
function byDateThenBarber(a: DayRow, b: DayRow): number {
  return (
    (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0) ||
    (a.barberId < b.barberId ? -1 : a.barberId > b.barberId ? 1 : 0)
  );
}

/**
 * The `TIME` drill-down's rows: each counted barber-day's figures — a
 * stored day's as held, a live day's `DayFiguresSystem.fold` (the same fold
 * that writes a day document) over the visits of its shop day — so the
 * live rows the report computes and the rows a stored day answers are spelt
 * by one rule. One row per barber-day (`DayFigures.rowOf`) for a period of
 * up to {@link DAY_GRAIN_MAX_DAYS} days; beyond that one per barber-month,
 * `DayFiguresSystem.sum` of the month's days filed under its first day.
 * Date, then barber.
 */
function dayRowsOf(
  input: AnalyticsInput,
  counting: Counting,
): readonly DayRow[] {
  const figures: DayFigures[] = [];
  for (let i = 0; i < input.pastDays.length; i++) {
    const day = input.pastDays[i] as DayFigures;
    if (counting.inScope(day.barberId)) figures.push(day);
  }
  const visitsOn = new Map<LocalDate, AnalyticsVisit[]>();
  for (let v = 0; v < input.visits.length; v++) {
    const visit = input.visits[v] as AnalyticsVisit;
    const list = visitsOn.get(visit.localDate);
    if (list === undefined) visitsOn.set(visit.localDate, [visit]);
    else list.push(visit);
  }
  for (let i = 0; i < input.days.length; i++) {
    const day = input.days[i] as AnalyticsDay;
    if (!counting.live(day.barberId, day.localDate)) continue;
    figures.push(
      DayFiguresSystem.fold({
        day,
        visits: visitsOn.get(day.localDate) ?? [],
        followUps: input.followUps,
        policy: input.policy,
        computedAtUtcMs: input.now.utcEpochMs,
        // A drill-down row reads the root alone.
        locationShares: [],
      }),
    );
  }
  const out: DayRow[] = [];
  if (rowsPerMonth(input.period.fromLocalDate, input.period.toLocalDate)) {
    const months = new Map<BusyKey, DayFigures[]>();
    for (let i = 0; i < figures.length; i++) {
      const day = figures[i] as DayFigures;
      const key = BusyKey.of(
        day.barberId,
        LocalDate.startOfMonth(day.localDate),
      );
      const list = months.get(key);
      if (list === undefined) months.set(key, [day]);
      else list.push(day);
    }
    for (const [key, list] of months) {
      const { barberId, localDate } = BusyKey.split(key);
      out.push(
        DayFigures.rowOf(DayFiguresSystem.sum(list, barberId, localDate)),
      );
    }
  } else {
    for (let i = 0; i < figures.length; i++) {
      out.push(DayFigures.rowOf(figures[i] as DayFigures));
    }
  }
  return out.sort(byDateThenBarber);
}

function seatRowsOf(
  input: AnalyticsInput,
  rebooked: ReadonlySet<AppointmentId>,
  past: PastOf,
  barberId: BarberId,
  counting: Counting,
): readonly AnalyticsReport.SeatRow[] {
  const out: AnalyticsReport.SeatRow[] = [];
  for (let v = 0; v < input.visits.length; v++) {
    const visit = input.visits[v] as AnalyticsVisit;
    // Every visit the pipeline read is a row (G4: the rows add up to the
    // figure the user tapped). A visit of a day HELD as stored figures
    // carries no rebooking mark: its follow-ups were not read — the
    // document knows the count, not the visits.
    const held = !counting.live(barberId, visit.localDate);
    const nets = MoneyAllocationSystem.seatNets(visit);
    const inBase = !held && past(barberId, visit.localDate);
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
        seatLateCancelled: DayFiguresSystem.isLateCancellation(
          visit,
          seat,
          input.policy,
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
