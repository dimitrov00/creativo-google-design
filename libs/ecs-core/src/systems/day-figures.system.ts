import {
  AttendanceState,
  BookingStatus,
  Currency,
  HourOfDay,
  LocalDate,
  MinuteCount,
  PriceCents,
  UtcEpochMs,
  type AppointmentId,
  type BarberId,
  type ServiceId,
} from '@core/primitives';
import {
  ANALYTICS_DEFINITION_VERSION,
  ClientStatsPolicy,
  type DayBody,
  DayFigures,
  type MinuteRange,
  Placement,
  Seat,
} from '@core/components';
import { AnalyticsHourSystem, type HourDay } from './analytics-hour.system';
import { ClientStatsSystem } from './client-stats.system';
import {
  MoneyAllocation,
  MoneyAllocationSystem,
  type SeatNet,
} from './money-allocation.system';
import type {
  AnalyticsDay,
  AnalyticsFollowUp,
  AnalyticsVisit,
} from './staff-analytics.system';

/**
 * Everything one barber-day's figures are folded from: the day as
 * `StaffAnalyticsSystem.daysOf` cut it (its parts on its own shop's clock,
 * its offered stretches, whether it is PAST), the visits of that shop day
 * (a seat of another barber, or a visit of another day, is skipped), the
 * follow-ups the rebooking rule reads and the policy the late line is
 * drawn by. Zone-blind: the day's clocks were resolved once by `daysOf`.
 */
export type DayBodyInput = {
  readonly day: AnalyticsDay;
  readonly visits: readonly AnalyticsVisit[];
  readonly followUps: readonly AnalyticsFollowUp[];
  readonly policy: ClientStatsPolicy;
};

/**
 * A stored day's fold: its body's inputs, the writer's `sourceReadUtcMs`
 * (the stamp), and each
 * touched location's share — empty unless the day touched two or more
 * (`StaffAnalyticsSystem.storedDayOf` decides and folds them; ADR
 * 2026-11-09). A live drill-down row reads the root alone and passes none.
 */
export type DayFoldInput = DayBodyInput & {
  readonly computedAtUtcMs: UtcEpochMs;
  readonly locationShares: readonly DayBody[];
};

/** A sum under construction — mutable inside one call only. */
type DayTotals = { -readonly [K in keyof DayFigures]: DayFigures[K] };

/** A service row under construction — mutable inside one call only. */
type ServiceTotals = {
  count: number;
  takings: PriceCents;
  minutes: number;
};

function minutes(raw: number): MinuteCount {
  return raw as MinuteCount;
}

/** The service rows, sorted by service id so a sum is spelt one way. */
function serviceRowsOf(
  rows: ReadonlyMap<ServiceId, ServiceTotals>,
): readonly DayFigures.ServiceRow[] {
  const out: DayFigures.ServiceRow[] = [];
  for (const [serviceId, row] of rows) {
    out.push({
      serviceId,
      workedSeatCount: row.count,
      takingsCents: row.takings,
      serviceMinutes: minutes(row.minutes),
    });
  }
  return out.sort((a, b) =>
    a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0,
  );
}

function addService(
  rows: Map<ServiceId, ServiceTotals>,
  serviceId: ServiceId,
  count: number,
  takings: PriceCents,
  serviceMinutes: number,
): void {
  const row = rows.get(serviceId);
  if (row === undefined) {
    rows.set(serviceId, { count, takings, minutes: serviceMinutes });
  } else {
    row.count += count;
    row.takings = PriceCents.add(row.takings, takings);
    row.minutes += serviceMinutes;
  }
}

/** `a + b`, bucket by bucket. */
function addBuckets(
  a: readonly MinuteCount[],
  b: readonly MinuteCount[],
): readonly MinuteCount[] {
  const out: MinuteCount[] = [];
  for (let h = 0; h < HourOfDay.PER_DAY; h++) {
    out.push(
      MinuteCount.add(
        (a[h] ?? MinuteCount.ZERO) as MinuteCount,
        (b[h] ?? MinuteCount.ZERO) as MinuteCount,
      ),
    );
  }
  return out;
}

/**
 * ONE BARBER-DAY'S FIGURES (`docs/designs/staff-analytics-v2.md`, «Systems
 * (pure)»): the fold that writes a day document and the sum that reads a
 * period back out of them. The per-visit rules are the catalogue's, applied
 * to one barber on one shop day; `StaffAnalyticsSystem.report` applies the
 * same rules over a scope, and property P1 — `sum(days.map(fold))` equals
 * `report(visits)` figure by figure — holds them to one another.
 *
 * Integer math throughout: minutes, euro cents, counts. A visit with
 * seats of two barbers lands on two days, so a figure a visit earns per
 * barber — the excluded count, the origin counts, the rebooking pair —
 * counts once on each.
 */
export const DayFiguresSystem = {
  /**
   * The visits that have a live follow-up booked by the end of the next
   * shop day (the rebooking rule, catalogue v1): a follow-up cancelled now
   * does not count, nor one booked from a visit not in `visits`.
   */
  rebookedVisits(
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
  },

  /**
   * Is this cancelled seat a LATE client cancellation (the client card's
   * rule): caused by the client, on a visit booked at a known instant, and
   * called off inside the seat's stamped window before the visit's start.
   */
  isLateCancellation(
    visit: AnalyticsVisit,
    seat: Seat,
    policy: ClientStatsPolicy,
  ): boolean {
    return (
      seat.attendanceState === AttendanceState.Cancelled &&
      ClientStatsSystem.clientCaused(seat) &&
      visit.bookedAtUtcMs !== null &&
      ClientStatsPolicy.isLateCancellation(
        policy,
        visit.utcEpochMs,
        seat.cancelledAtUtcMs,
        seat.cancellationWindowHours,
      )
    );
  },

  /**
   * The day's hour buckets (`AnalyticsHourSystem.bucketsOf`): its offered
   * stretches, and the chair time of the barber's WORKED seats on visits of
   * that day that are not wholly cancelled — the same minutes
   * `ChairDay.workedMinutes` counts, clipped to the roster.
   */
  hourBuckets(day: AnalyticsDay, visits: readonly AnalyticsVisit[]): HourDay {
    const seats: MinuteRange[] = [];
    for (let v = 0; v < visits.length; v++) {
      const visit = visits[v] as AnalyticsVisit;
      if (
        visit.localDate !== day.localDate ||
        visit.bookingStatus === BookingStatus.Cancelled
      ) {
        continue;
      }
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as Seat;
        if (
          seat.barberId === day.barberId &&
          seat.attendanceState === AttendanceState.Worked
        ) {
          seats.push(Seat.chairTime(seat));
        }
      }
    }
    return AnalyticsHourSystem.bucketsOf(day.localDate, seats, day.stretches);
  },

  /**
   * THE FOLD: one barber-day's figures from its cut day and its visits.
   * The parts and the closed-day minutes are the day's own; every seat of
   * the barber on a visit of that day adds to the counts, the money
   * (`MoneyAllocationSystem.seatNets`, euro cents; a visit whose bill could
   * not be evaluated adds nothing and is counted excluded) and its service
   * row; a visit with a worked seat of the barber is counted by its origin
   * and — on a PAST day only (Terms, «Past day») — in the rebooking base,
   * rebooked when a live follow-up was booked by the end of the next day.
   */
  fold(input: DayFoldInput): DayFigures {
    return {
      ...DayFiguresSystem.body(input),
      dayLocationIds: input.day.locationIds,
      dayLocations: input.locationShares,
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      dayComputedAtUtcMs: input.computedAtUtcMs,
    };
  },

  /**
   * A barber-day's figures without where or when they were folded — the
   * root of {@link fold}, and each location's share of a split day.
   */
  body(input: DayBodyInput): DayBody {
    const { day, policy } = input;
    const rebooked = DayFiguresSystem.rebookedVisits(
      input.visits,
      input.followUps,
    );
    let takings = PriceCents.ZERO;
    let tips = PriceCents.ZERO;
    let excluded = 0;
    let workedSeats = 0;
    let noShows = 0;
    let noShowBase = 0;
    let rebookedBase = 0;
    let rebookedCount = 0;
    let lateCancellations = 0;
    let online = 0;
    let staff = 0;
    let unknown = 0;
    const services = new Map<ServiceId, ServiceTotals>();

    for (let v = 0; v < input.visits.length; v++) {
      const visit = input.visits[v] as AnalyticsVisit;
      if (visit.localDate !== day.localDate) continue;
      const nets = MoneyAllocationSystem.seatNets(visit);
      let worked = false;
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as Seat;
        if (seat.barberId !== day.barberId) continue;
        switch (seat.attendanceState) {
          case AttendanceState.Worked: {
            worked = true;
            workedSeats++;
            noShowBase++;
            let net = PriceCents.ZERO;
            if (nets.moneyAllocation === MoneyAllocation.Allocated) {
              const seatNet = nets.nets[s] as SeatNet;
              net = seatNet.netCents;
              takings = PriceCents.add(takings, net);
              tips = PriceCents.add(tips, seatNet.tipCents);
            }
            addService(services, seat.serviceId, 1, net, seat.durationMinutes);
            break;
          }
          case AttendanceState.NoShow:
            noShows++;
            noShowBase++;
            break;
          case AttendanceState.Cancelled:
            if (DayFiguresSystem.isLateCancellation(visit, seat, policy)) {
              lateCancellations++;
            }
            break;
          case AttendanceState.Scheduled:
            break;
        }
      }
      if (!worked) continue;
      if (nets.moneyAllocation === MoneyAllocation.NotEvaluated) excluded++;
      if (visit.placement === Placement.Self) online++;
      else if (visit.placement === Placement.Staff) staff++;
      else unknown++;
      if (day.pastDay) {
        rebookedBase++;
        if (rebooked.has(visit.id)) rebookedCount++;
      }
    }

    const hours = DayFiguresSystem.hourBuckets(day, input.visits);
    return {
      barberId: day.barberId,
      localDate: day.localDate,
      dayRosteredMinutes: day.rosteredMinutes,
      dayWorkedMinutes: day.workedMinutes,
      dayNoShowMinutes: day.noShowMinutes,
      dayUnmarkedMinutes: day.unmarkedMinutes,
      dayBookedAheadMinutes: day.bookedAheadMinutes,
      dayHeldMinutes: day.heldMinutes,
      dayBlockedMinutes: day.blockedMinutes,
      dayBreakMinutes: day.breakMinutes,
      dayShortGapMinutes: day.shortGapMinutes,
      dayUnsoldMinutes: day.unsoldMinutes,
      dayOpenMinutes: day.openMinutes,
      dayClosedDayMinutes: day.closedDayMinutes,
      dayTakingsCents: takings,
      dayTipsCents: tips,
      currency: Currency.EUR,
      dayOutsideHoursMinutes: day.outsideHoursMinutes,
      dayOutsideHoursSeatCount: day.outsideHoursSeatCount,
      dayExcludedVisitCount: excluded,
      dayWorkedSeatCount: workedSeats,
      dayNoShowCount: noShows,
      dayNoShowBase: noShowBase,
      dayRebookedBase: rebookedBase,
      dayRebookedCount: rebookedCount,
      dayLateCancellationCount: lateCancellations,
      dayOnlineVisitCount: online,
      dayStaffVisitCount: staff,
      dayUnknownOriginVisitCount: unknown,
      dayServices: serviceRowsOf(services),
      dayHourWorked: hours.worked,
      dayHourRostered: hours.rostered,
    };
  },

  /**
   * THE SUM of several days' figures, filed under `barberId` and
   * `localDate` (a barber's month under its first day; a shop's total under
   * the scope's first barber): every minute, cent and count added, the
   * service rows merged by `serviceId` (sorted by it), the hour buckets
   * added bucket-wise, the ratio per hour left to the reader. Stamped with
   * this definition and the OLDEST part's `dayComputedAtUtcMs` — a total is
   * as current as its stalest day — or the epoch with no part at all.
   */
  sum(
    figures: readonly DayFigures[],
    barberId: BarberId,
    localDate: LocalDate,
  ): DayFigures {
    const total: DayTotals = {
      ...DayFigures.empty(barberId, localDate, UtcEpochMs.EPOCH),
    };
    const services = new Map<ServiceId, ServiceTotals>();
    let hourWorked = total.dayHourWorked;
    let hourRostered = total.dayHourRostered;
    let oldest: UtcEpochMs | null = null;
    const minuteFields = DayFigures.MINUTE_FIELDS;
    const countFields = DayFigures.COUNT_FIELDS;
    for (let i = 0; i < figures.length; i++) {
      const day = figures[i] as DayFigures;
      for (let f = 0; f < minuteFields.length; f++) {
        const field = minuteFields[f] as (typeof minuteFields)[number];
        total[field] = MinuteCount.add(total[field], day[field]);
      }
      for (let f = 0; f < countFields.length; f++) {
        const field = countFields[f] as (typeof countFields)[number];
        total[field] = total[field] + day[field];
      }
      total.dayTakingsCents = PriceCents.add(
        total.dayTakingsCents,
        day.dayTakingsCents,
      );
      total.dayTipsCents = PriceCents.add(total.dayTipsCents, day.dayTipsCents);
      for (let s = 0; s < day.dayServices.length; s++) {
        const row = day.dayServices[s] as DayFigures.ServiceRow;
        addService(
          services,
          row.serviceId,
          row.workedSeatCount,
          row.takingsCents,
          row.serviceMinutes,
        );
      }
      hourWorked = addBuckets(hourWorked, day.dayHourWorked);
      hourRostered = addBuckets(hourRostered, day.dayHourRostered);
      if (
        oldest === null ||
        UtcEpochMs.compare(day.dayComputedAtUtcMs, oldest) < 0
      ) {
        oldest = day.dayComputedAtUtcMs;
      }
    }
    return {
      ...total,
      dayServices: serviceRowsOf(services),
      dayHourWorked: hourWorked,
      dayHourRostered: hourRostered,
      dayComputedAtUtcMs: oldest ?? UtcEpochMs.EPOCH,
    };
  },
} as const;
