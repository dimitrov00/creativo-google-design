import {
  EndMinute,
  HourOfDay,
  LocalDate,
  MinuteCount,
  MinuteOfDay,
  type Weekday,
} from '@core/primitives';
import type { AnalyticsReport, MinuteRange } from '@core/components';
import { IntervalSetSystem } from './interval-set.system';

/**
 * One barber-day's hour buckets (`docs/designs/staff-analytics-v2.md`,
 * Terms «Hour buckets»): 24 entries each, the minutes of worked and of
 * rostered time overlapping `[h:00, h+1:00)` on the shop's wall clock — so a
 * DST day is 24 buckets too, and the local minutes never meet an instant
 * (Law 7.3).
 */
export type HourDay = {
  readonly localDate: LocalDate;
  readonly worked: readonly MinuteCount[];
  readonly rostered: readonly MinuteCount[];
};

/** One heatmap cell — the report's row (`AnalyticsReport.HourCell`): a weekday, an hour and the two sums. */
export type HourCell = AnalyticsReport.HourCell;

/** A cell the heatmap's sentence names: its weekday and wall-clock hour. */
export type HourPeak = {
  readonly weekday: Weekday;
  readonly hour: HourOfDay;
};

/** The busiest and the emptiest cell of a grid; `null` each under the base of rostered days. */
export type HourPeaks = {
  readonly busiest: HourPeak | null;
  readonly emptiest: HourPeak | null;
};

/** The rostered days a period needs before the heatmap names a busiest or emptiest hour. */
const PEAK_DAY_BASE = 7;

/** Minutes in an hour — the bucket's width. */
const MINUTES_PER_HOUR = 60;

/** Days in a week — the grid's rows. */
const DAYS_PER_WEEK = 7;

/**
 * Adds every range's overlap with each hour to `into` (24 entries): one
 * linear walk over the ranges, each split at the hour marks it crosses. No
 * allocation.
 */
function addBuckets(into: MinuteCount[], ranges: readonly MinuteRange[]): void {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i] as MinuteRange;
    let hour = Math.floor(range.startMinutes / MINUTES_PER_HOUR);
    while (hour * MINUTES_PER_HOUR < range.endMinutes) {
      const markStart = hour * MINUTES_PER_HOUR;
      const markEnd = markStart + MINUTES_PER_HOUR;
      const from =
        range.startMinutes > markStart ? range.startMinutes : markStart;
      const to = range.endMinutes < markEnd ? range.endMinutes : markEnd;
      into[hour] = MinuteCount.add(
        into[hour] as MinuteCount,
        MinuteCount.span(MinuteOfDay.ofProven(from), EndMinute.ofProven(to)),
      );
      hour++;
    }
  }
}

function emptyBuckets(): MinuteCount[] {
  const out: MinuteCount[] = [];
  for (let h = 0; h < HourOfDay.PER_DAY; h++) out.push(MinuteCount.ZERO);
  return out;
}

/** `a` comes before `b` in the grid's order — weekday, then hour. */
function earlier(a: HourCell, b: HourCell): boolean {
  return a.weekday !== b.weekday ? a.weekday < b.weekday : a.hour < b.hour;
}

/**
 * `worked ÷ rostered` of `a` against `b`, compared exactly — cross-multiplied
 * integers, so two equal fractions tie (`30/60` and `60/120`) instead of
 * drifting apart in floating point. Both cells carry rostered minutes.
 */
function compareFill(a: HourCell, b: HourCell): number {
  return (
    a.workedMinutes * b.rosteredMinutes - b.workedMinutes * a.rosteredMinutes
  );
}

/**
 * THE HOUR GRID (staff analytics v2, the heatmap). Pure integer math over
 * one day's wall-clock ranges and over the grid's 168 cells.
 */
export const AnalyticsHourSystem = {
  PEAK_DAY_BASE,

  /**
   * One barber-day's buckets. `stretches` are the day's rostered stretches
   * (the windows, blocks and breaks the roster offers — what
   * `ChairDay.rosteredMinutes` totals); `seats` the chair time of its WORKED
   * seats. The rostered buckets take the stretches' union; the worked
   * buckets take the seats' union CLIPPED to that union — the same minutes
   * `ChairDay.workedMinutes` counts (worked is first in the chair's
   * precedence, and time outside the roster is `outsideHoursMinutes`, never
   * a part), so a day's worked buckets sum to its worked minutes. Worked,
   * not occupied: a no-show seat is not handed in.
   */
  bucketsOf(
    localDate: LocalDate,
    seats: readonly MinuteRange[],
    stretches: readonly MinuteRange[],
  ): HourDay {
    const rostered = IntervalSetSystem.normalize(stretches);
    const worked = IntervalSetSystem.intersect(seats, rostered);
    const workedBuckets = emptyBuckets();
    const rosteredBuckets = emptyBuckets();
    addBuckets(workedBuckets, worked);
    addBuckets(rosteredBuckets, rostered);
    return { localDate, worked: workedBuckets, rostered: rosteredBuckets };
  },

  /**
   * Weekday × hour over `days`: each cell sums the buckets of every day of
   * its weekday. Only cells with minutes are listed (so at most 168), in
   * weekday-then-hour order; a shop's barber-days on one date each add to
   * the same cells.
   */
  grid(days: readonly HourDay[]): readonly HourCell[] {
    const cells = DAYS_PER_WEEK * HourOfDay.PER_DAY;
    const worked: MinuteCount[] = [];
    const rostered: MinuteCount[] = [];
    for (let i = 0; i < cells; i++) {
      worked.push(MinuteCount.ZERO);
      rostered.push(MinuteCount.ZERO);
    }
    // The weekday of each row, learnt from the days that land on it.
    const weekdayOf: (Weekday | null)[] = [];
    for (let w = 0; w < DAYS_PER_WEEK; w++) weekdayOf.push(null);

    for (let d = 0; d < days.length; d++) {
      const day = days[d] as HourDay;
      const weekday = LocalDate.weekday(day.localDate);
      const row = weekday - 1;
      weekdayOf[row] = weekday;
      const base = row * HourOfDay.PER_DAY;
      for (let h = 0; h < HourOfDay.PER_DAY; h++) {
        worked[base + h] = MinuteCount.add(
          worked[base + h] as MinuteCount,
          day.worked[h] as MinuteCount,
        );
        rostered[base + h] = MinuteCount.add(
          rostered[base + h] as MinuteCount,
          day.rostered[h] as MinuteCount,
        );
      }
    }

    const out: HourCell[] = [];
    for (let row = 0; row < DAYS_PER_WEEK; row++) {
      const weekday = weekdayOf[row] ?? null;
      if (weekday === null) continue;
      const base = row * HourOfDay.PER_DAY;
      for (let h = 0; h < HourOfDay.PER_DAY; h++) {
        const workedMinutes = worked[base + h] as MinuteCount;
        const rosteredMinutes = rostered[base + h] as MinuteCount;
        if (workedMinutes === 0 && rosteredMinutes === 0) continue;
        out.push({
          weekday,
          hour: HourOfDay.ALL[h] as HourOfDay,
          workedMinutes,
          rosteredMinutes,
        });
      }
    }
    return out;
  },

  /**
   * The heatmap's sentence: among the cells with rostered minutes, the one
   * with the highest `worked ÷ rostered` and the one with the lowest — the
   * earliest (weekday, then hour) on a tie. Both `null` when the period has
   * fewer than {@link PEAK_DAY_BASE} rostered days: one busy Tuesday is not
   * a pattern.
   */
  peak(cells: readonly HourCell[], rosteredDayCount: number): HourPeaks {
    if (rosteredDayCount < PEAK_DAY_BASE) {
      return { busiest: null, emptiest: null };
    }
    let busiest: HourCell | null = null;
    let emptiest: HourCell | null = null;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as HourCell;
      if (cell.rosteredMinutes === 0) continue;
      if (busiest === null) {
        busiest = cell;
        emptiest = cell;
        continue;
      }
      const againstBusiest = compareFill(cell, busiest);
      if (
        againstBusiest > 0 ||
        (againstBusiest === 0 && earlier(cell, busiest))
      ) {
        busiest = cell;
      }
      const againstEmptiest = compareFill(cell, emptiest as HourCell);
      if (
        againstEmptiest < 0 ||
        (againstEmptiest === 0 && earlier(cell, emptiest as HourCell))
      ) {
        emptiest = cell;
      }
    }
    return {
      busiest:
        busiest === null
          ? null
          : { weekday: busiest.weekday, hour: busiest.hour },
      emptiest:
        emptiest === null
          ? null
          : { weekday: emptiest.weekday, hour: emptiest.hour },
    };
  },
} as const;
