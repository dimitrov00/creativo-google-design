import {
  AttendanceState,
  BookingStatus,
  EndMinute,
  LocalDate,
  MinuteCount,
  MinuteOfDay,
} from '@core/primitives';
import { MinuteRange, Seat, type ShopNow } from '@core/components';
import type { Appointment } from '@core/entities';
import {
  GridLayoutSystem,
  type LaneGap,
  type OccupyingSeat,
} from './grid-layout.system';
import { IntervalSetSystem } from './interval-set.system';

/** A seat as the chair's day reads it: where it sits and what became of it. */
export type ChairSeat = OccupyingSeat & Pick<Seat, 'attendanceState'>;

/** A visit as the chair's day reads it — an `Appointment` satisfies it as is. */
export type ChairVisit = Pick<Appointment, 'bookingStatus'> & {
  readonly seats: readonly ChairSeat[];
};

/**
 * One barber-day, as `RosterSystem` offers it: the carved windows (blocks and
 * breaks already out, `offeredWindows`), the blocks (`offeredCarveOuts`) and
 * the breaks (`offeredBreaks`) — the same three a schedule lane is built
 * from — plus the day's visits and the shop's now at the day's location.
 */
export type ChairDayInput = {
  readonly barberId: Seat['barberId'];
  readonly localDate: LocalDate;
  readonly windows: readonly MinuteRange[];
  readonly blocks: readonly MinuteRange[];
  readonly breaks: readonly MinuteRange[];
  readonly visits: readonly ChairVisit[];
  readonly now: ShopNow;
};

/**
 * Where every rostered minute of a barber-day went
 * (`docs/designs/staff-analytics.md`, the metric catalogue). Each rostered
 * minute is in exactly one of the ten parts, so they always sum to
 * `rosteredMinutes`; the `past…` fields are the parts of `blocked`, `held`
 * and `shortGap` that lie before the current minute (worked, no-show,
 * unmarked and unsold are past by definition, booked ahead and open are
 * future by definition) — what the time bar draws up to now.
 */
export type ChairDay = {
  readonly barberId: Seat['barberId'];
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
  readonly pastBlockedMinutes: MinuteCount;
  readonly pastHeldMinutes: MinuteCount;
  readonly pastShortGapMinutes: MinuteCount;
  /** Chair time of `WORKED` seats outside rostered time (a visit before opening). Never in the parts. */
  readonly outsideHoursMinutes: MinuteCount;
  /** How many `WORKED` seats reach outside rostered time. */
  readonly outsideHoursSeatCount: number;
};

/**
 * The first minute of `localDate` that is not yet past: the day's end for a
 * day before today, its start for a day after it, the current minute today.
 */
function cutOf(localDate: LocalDate, now: ShopNow): number {
  const day = LocalDate.compare(localDate, now.localDate);
  return day < 0 ? 1440 : day > 0 ? 0 : now.currentMinute;
}

/** `[from, to)` as a range set — empty when the span is. */
function span(from: number, to: number): readonly MinuteRange[] {
  return to > from
    ? [MinuteRange.of(MinuteOfDay.ofProven(from), EndMinute.ofProven(to))]
    : [];
}

const total = IntervalSetSystem.totalMinutes;

/**
 * THE CHAIR'S DAY, PARTITIONED (staff analytics, catalogue v1). Precedence,
 * per minute of rostered time:
 *
 * 1. **Occupied** — the union of the chair time of the barber's seats on
 *    visits that are not wholly cancelled (`GridLayoutSystem.occupiedIntervals`'
 *    rule, so a cancelled seat in a live party still holds the chair). A
 *    minute under several seats takes the first of worked → no-show →
 *    unmarked (scheduled, before now) → booked ahead (scheduled, from now)
 *    → held (a cancelled seat). A seat over a block or a break counts here.
 * 2. **Blocked**, then 3. **break**, on the minutes left.
 * 4. **Holes** — the schedule's own (`GridLayoutSystem.holes` over the carved
 *    windows): short gaps (under 20 minutes), open (the future part of a hole
 *    the schedule still offers, `sellableAt` → `sellable`) and unsold (the
 *    rest of every hole of 20 minutes or more).
 *
 * Unsold + open is therefore exactly the schedule's day-summary free time
 * (the whole minutes of its sellable-sized holes).
 */
export const ChairTimeSystem = {
  dayBreakdown(input: ChairDayInput): ChairDay {
    const rostered = IntervalSetSystem.normalize([
      ...input.windows,
      ...input.blocks,
      ...input.breaks,
    ]);
    const cut = cutOf(input.localDate, input.now);
    const past = span(0, cut);
    const ahead = span(cut, 1440);

    const worked: MinuteRange[] = [];
    const noShow: MinuteRange[] = [];
    const scheduled: MinuteRange[] = [];
    const held: MinuteRange[] = [];
    let outsideHoursSeatCount = 0;
    const outside: MinuteRange[] = [];
    for (let v = 0; v < input.visits.length; v++) {
      const visit = input.visits[v] as ChairVisit;
      if (visit.bookingStatus === BookingStatus.Cancelled) continue;
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as ChairSeat;
        if (seat.barberId !== input.barberId) continue;
        const chair = Seat.chairTime(seat);
        switch (seat.attendanceState) {
          case AttendanceState.Worked: {
            worked.push(chair);
            const beyond = IntervalSetSystem.subtract([chair], rostered);
            if (beyond.length > 0) {
              outsideHoursSeatCount++;
              for (let b = 0; b < beyond.length; b++) {
                outside.push(beyond[b] as MinuteRange);
              }
            }
            break;
          }
          case AttendanceState.NoShow:
            noShow.push(chair);
            break;
          case AttendanceState.Scheduled:
            scheduled.push(chair);
            break;
          case AttendanceState.Cancelled:
            held.push(chair);
            break;
        }
      }
    }

    // Occupied parts, each minus everything that outranks it.
    let taken: readonly MinuteRange[] = [];
    const claim = (ranges: readonly MinuteRange[]): readonly MinuteRange[] => {
      const part = IntervalSetSystem.subtract(
        IntervalSetSystem.intersect(ranges, rostered),
        taken,
      );
      taken = IntervalSetSystem.union(taken, part);
      return part;
    };
    const workedPart = claim(worked);
    const noShowPart = claim(noShow);
    const unmarkedPart = claim(IntervalSetSystem.intersect(scheduled, past));
    const bookedAheadPart = claim(
      IntervalSetSystem.intersect(scheduled, ahead),
    );
    const heldPart = claim(held);
    const blockedPart = claim(input.blocks);
    const breakPart = claim(input.breaks);

    // The holes are the schedule's: carved windows minus occupied time.
    const holes = GridLayoutSystem.holes(
      input.windows,
      GridLayoutSystem.occupiedIntervals(input.visits, input.barberId, []),
    );
    const sellableSized = GridLayoutSystem.sellableAt(
      holes,
      input.now,
      input.localDate,
    );
    const big: MinuteRange[] = [];
    const open: MinuteRange[] = [];
    for (let i = 0; i < sellableSized.length; i++) {
      const gap = sellableSized[i] as LaneGap;
      big.push(gap);
      if (gap.sellable) {
        const future = IntervalSetSystem.intersect([gap], ahead);
        for (let f = 0; f < future.length; f++) {
          open.push(future[f] as MinuteRange);
        }
      }
    }
    const shortGap = IntervalSetSystem.subtract(holes, big);
    const unsold = IntervalSetSystem.subtract(big, open);

    return {
      barberId: input.barberId,
      localDate: input.localDate,
      rosteredMinutes: total(rostered),
      workedMinutes: total(workedPart),
      noShowMinutes: total(noShowPart),
      unmarkedMinutes: total(unmarkedPart),
      bookedAheadMinutes: total(bookedAheadPart),
      heldMinutes: total(heldPart),
      blockedMinutes: total(blockedPart),
      breakMinutes: total(breakPart),
      shortGapMinutes: total(shortGap),
      unsoldMinutes: total(unsold),
      openMinutes: total(open),
      pastBlockedMinutes: total(IntervalSetSystem.intersect(blockedPart, past)),
      pastHeldMinutes: total(IntervalSetSystem.intersect(heldPart, past)),
      pastShortGapMinutes: total(IntervalSetSystem.intersect(shortGap, past)),
      outsideHoursMinutes: total(outside),
      outsideHoursSeatCount,
    };
  },

  /** Every part summed — equals `rosteredMinutes` for any day (the partition's invariant). */
  partsTotal(day: ChairDay): MinuteCount {
    let sum = MinuteCount.ZERO;
    const parts = [
      day.workedMinutes,
      day.noShowMinutes,
      day.unmarkedMinutes,
      day.bookedAheadMinutes,
      day.heldMinutes,
      day.blockedMinutes,
      day.breakMinutes,
      day.shortGapMinutes,
      day.unsoldMinutes,
      day.openMinutes,
    ];
    for (let i = 0; i < parts.length; i++) {
      sum = MinuteCount.add(sum, parts[i] as MinuteCount);
    }
    return sum;
  },
} as const;
