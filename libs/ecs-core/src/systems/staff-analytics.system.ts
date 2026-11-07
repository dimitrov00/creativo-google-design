import {
  AttendanceState,
  LocalDate,
  MinuteCount,
  PriceCents,
  Result,
  type AppointmentId,
  type BarberId,
  type ServiceId,
  type Weekday,
} from '@core/primitives';
import { AnalyticsError } from '@core/errors';
import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsFigure,
  AnalyticsPeriod,
  type AnalyticsCall,
  type AnalyticsReport,
  BookingOrigin,
  ClientStatsPolicy,
  Placement,
  type Role,
  Roles,
  type Seat,
  type ShopNow,
} from '@core/components';
import type { Appointment } from '@core/entities';
import type { ChairDay } from './chair-time.system';
import { ClientStatsSystem } from './client-stats.system';
import {
  MoneyAllocation,
  MoneyAllocationSystem,
  type SeatNet,
} from './money-allocation.system';

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

/** A barber-day's parts, with the minutes a `CLOSED` day would have rostered. */
export type AnalyticsDay = ChairDay & {
  readonly closedDayMinutes: MinuteCount;
};

/** Everything a report is computed from — read by the pipeline, nothing else. */
export type AnalyticsInput = {
  /** The barber record reported on; `null` for the shop. */
  readonly scopeBarberId: BarberId | null;
  /** The barber records in scope: the one, or every one of the shop. */
  readonly barberIds: readonly BarberId[];
  readonly period: AnalyticsPeriod;
  /** The scope's barber-days of the period. */
  readonly days: readonly AnalyticsDay[];
  /** The scope's barber-days of the next 7 shop days from today. */
  readonly aheadDays: readonly ChairDay[];
  /** The period's visits with a seat in scope, each once. */
  readonly visits: readonly AnalyticsVisit[];
  /** The previous period's visits with a seat in scope — for the hero only. */
  readonly previousVisits: readonly AnalyticsVisit[];
  readonly followUps: readonly AnalyticsFollowUp[];
  readonly policy: ClientStatsPolicy;
  readonly now: ShopNow;
};

/** What a drill-down narrows its rows by; `null` narrows nothing. */
export type AnalyticsRowFilter = {
  readonly serviceId: ServiceId | null;
  readonly localDate: LocalDate | null;
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

/**
 * STAFF ANALYTICS (`docs/designs/staff-analytics.md`, catalogue v1) — the
 * visibility table and the report, every value decided here so a presenter
 * only words it (Law 10).
 */
export const StaffAnalyticsSystem = {
  RATE_BASE,

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

    // The hero: the compared days of this period against the previous one.
    const period = input.period;
    const previous = AnalyticsPeriod.previous(period);
    const today = input.now.localDate;
    const running =
      period.fromLocalDate <= today && today <= period.toLocalDate;
    const length = AnalyticsPeriod.length(period);
    const compared = running
      ? LocalDate.daysBetween(period.fromLocalDate, today) + 1
      : length;
    const previousCompared = Math.min(
      compared,
      AnalyticsPeriod.length(previous),
    );
    const cutIndex = running ? compared - 1 : null;
    const heroCurrent = heroTakings(
      input.visits,
      inScope,
      period.fromLocalDate,
      compared,
      cutIndex,
      input.now.currentMinute,
    );
    const hadPrevious = input.previousVisits.some((visit) =>
      visit.seats.some(
        (seat) =>
          inScope(seat.barberId) &&
          seat.attendanceState === AttendanceState.Worked,
      ),
    );
    const heroPrevious = hadPrevious
      ? heroTakings(
          input.previousVisits,
          inScope,
          previous.fromLocalDate,
          previousCompared,
          cutIndex !== null && cutIndex < previousCompared ? cutIndex : null,
          input.now.currentMinute,
        )
      : null;

    return {
      reportDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      reportComputedAtUtcMs: input.now.utcEpochMs,
      reportScopeBarberId: input.scopeBarberId,
      reportAnalyticsSpan: period.analyticsSpan,
      reportFromLocalDate: period.fromLocalDate,
      reportToLocalDate: period.toLocalDate,

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

      ...bookableOf(input.aheadDays, inScope),

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
} as const;

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

function bookableOf(
  aheadDays: readonly ChairDay[],
  inScope: (barberId: BarberId) => boolean,
): {
  readonly reportBookableOpenMinutes: MinuteCount;
  readonly reportEmptiestLocalDate: LocalDate | null;
} {
  const byDay = new Map<LocalDate, number>();
  let total = 0;
  for (let i = 0; i < aheadDays.length; i++) {
    const day = aheadDays[i] as ChairDay;
    if (!inScope(day.barberId)) continue;
    total += day.openMinutes;
    byDay.set(day.localDate, (byDay.get(day.localDate) ?? 0) + day.openMinutes);
  }
  let emptiest: LocalDate | null = null;
  let most = 0;
  const days = [...byDay.keys()].sort();
  for (let i = 0; i < days.length; i++) {
    const day = days[i] as LocalDate;
    const open = byDay.get(day) ?? 0;
    if (open > most) {
      most = open;
      emptiest = day;
    }
  }
  return {
    reportBookableOpenMinutes: minutes(total),
    reportEmptiestLocalDate: emptiest,
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
