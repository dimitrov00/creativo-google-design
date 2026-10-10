import type { DayKey } from './day-key.data';
import type { Weekday } from './weekday.data';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

/**
 * One civil day of one zone — a row of the zone table every time-math system
 * takes as a parameter. Only `ZonedTimeSystem.dayTable` /
 * `dayTableAround` build rows (they are the only reads of a zone's offsets);
 * everything else is subtraction and binary search over the rows. Every field
 * is present on every row, so every row shares one hidden class.
 *
 * - `dayStartMs` — the first instant of the day (local midnight, or the end
 *   of the gap when a transition erases midnight itself).
 * - `offsetMinutes` — UTC offset of the clock that reads 00:00 at
 *   `dayStartMs`: the offset in force at local midnight.
 * - `transitionAtMinutes` — the wall-clock minute at which the offset changes
 *   that day, read on the clock in force BEFORE the change (equivalently, the
 *   minutes elapsed from `dayStartMs` to the change); `null` on an ordinary
 *   day. Europe/Sofia: `180` on 2026-03-29 (03:00 → 04:00), `240` on
 *   2026-10-25 (04:00 → 03:00).
 * - `transitionDeltaMinutes` — the change itself: `+60` spring, `−60` autumn,
 *   `0` on an ordinary day. The day lasts `1440 − delta` minutes, so the
 *   23-hour and 25-hour days — and the erased or repeated wall-clock segment
 *   `[at, at + 60)` / `[at − 60, at)` — are carried by the row.
 * - `weekday` — ISO 1..7, computed once per row from the civil epoch day.
 *
 * A table is sorted by `dayKey` (equivalently by `dayStartMs`).
 */
export type DayOffset = {
  readonly dayKey: DayKey;
  readonly dayStartMs: number;
  readonly offsetMinutes: number;
  readonly transitionAtMinutes: number | null;
  readonly transitionDeltaMinutes: number;
  readonly weekday: Weekday;
};

export const DayOffset = {
  /** Real minutes the day lasts: 1440, or 1380 / 1500 on a DST day. */
  lengthMinutes(day: DayOffset): number {
    return MINUTES_PER_DAY - day.transitionDeltaMinutes;
  },

  /** The exclusive end of the day — the first instant of the next one. */
  endMs(day: DayOffset): number {
    return day.dayStartMs + DayOffset.lengthMinutes(day) * MS_PER_MINUTE;
  },

  /** The offset changes during this day. */
  isTransition(day: DayOffset): boolean {
    return day.transitionAtMinutes !== null;
  },

  /** Row index of `dayKey` — binary search over the sorted table; `−1` when absent. */
  indexOf(dayKey: DayKey, days: readonly DayOffset[]): number {
    let lo = 0;
    let hi = days.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const key = (days[mid] as DayOffset).dayKey;
      if (key === dayKey) return mid;
      if (key < dayKey) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  },

  /** The row of `dayKey`, or `null` when the table does not cover it. */
  find(dayKey: DayKey, days: readonly DayOffset[]): DayOffset | null {
    const index = DayOffset.indexOf(dayKey, days);
    return index < 0 ? null : (days[index] as DayOffset);
  },

  /**
   * Row index of the day containing the instant — the last row starting at
   * or before `epochMs`, provided `epochMs` falls before that row's end;
   * `−1` when the table does not cover it.
   */
  indexAt(epochMs: number, days: readonly DayOffset[]): number {
    let lo = 0;
    let hi = days.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if ((days[mid] as DayOffset).dayStartMs <= epochMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= 0 && epochMs < DayOffset.endMs(days[found] as DayOffset)
      ? found
      : -1;
  },

  /** The weekday the table records for `dayKey`, or `null` when absent. */
  weekdayOf(dayKey: DayKey, days: readonly DayOffset[]): Weekday | null {
    const index = DayOffset.indexOf(dayKey, days);
    return index < 0 ? null : (days[index] as DayOffset).weekday;
  },
} as const;
