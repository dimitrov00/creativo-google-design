import { DateRange, DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { Weekday } from '../components/weekday.data';

const DAYS_PER_WEEK = 7;

/** One day of a month grid — the month's own, or a neighbour's padding it. */
export type CalendarCell = {
  readonly dayKey: DayKey;
  /** ISO 1..7, read off the day table's row. */
  readonly weekday: Weekday;
  /** 1..31. */
  readonly dayOfMonth: number;
  /** The grid's own month — `false` for the padding days of its neighbours. */
  readonly inMonth: boolean;
  /** How many of the marks fall on this day. */
  readonly marks: number;
};

/** Seven cells, Monday first. */
export type CalendarWeek = readonly CalendarCell[];

/** The ISO weekday of a day: the table's row, else the civil count (the same value). */
function weekdayOf(dayKey: DayKey, days: readonly DayOffset[]): Weekday {
  return (
    DayOffset.weekdayOf(dayKey, days) ??
    Weekday.ofEpochDay(DayKey.toEpochDay(dayKey))
  );
}

/**
 * CalendarGridSystem — a Monday-first month grid padded to whole weeks
 * (`client/appointments/src/lib/calendar-month.ts`, `client-appointments.ts`
 * `buildMonth`; the booking and month-picker builders are wired by their own
 * groups). Day keys and counts only: no zone lookup, no `Intl`, no `Date` —
 * the weekday of every cell is the day table's `DayOffset.weekday`, the
 * table built once per visible range by the caller (`ZonedTimeSystem.
 * dayTable` over {@link gridRange}); a day the table does not cover falls
 * back to the civil weekday count, which is the value the row would carry.
 * "Today" is a comparison of day keys in the template, not a grid fact.
 */
export const CalendarGridSystem = {
  /** Monday-first: the Monday on or before `dayKey`. */
  startOfWeek(dayKey: DayKey, days: readonly DayOffset[]): DayKey {
    const back = weekdayOf(dayKey, days) - Weekday.Mon;
    return DayKey.fromEpochDay(DayKey.toEpochDay(dayKey) - back);
  },

  /**
   * The days a month's grid shows: the Monday on or before its 1st through
   * the Sunday on or after its last day — the range to build the day table
   * over. `monthDay` is any day of the month.
   */
  gridRange(monthDay: DayKey): DateRange {
    const year = Number(monthDay.slice(0, 4));
    const month = Number(monthDay.slice(5, 7));
    const first = DayKey.epochDayOf(year, month, 1);
    const last = first + DayKey.daysInMonth(year, month) - 1;
    const lead = Weekday.ofEpochDay(first) - Weekday.Mon;
    const trail = Weekday.Sun - Weekday.ofEpochDay(last);
    return DateRange.of(
      DayKey.fromEpochDay(first - lead),
      DayKey.fromEpochDay(last + trail),
    );
  },

  /**
   * The month of `monthDay` as whole weeks, Monday first: the leading days
   * of the month before, every day of the month, the trailing days of the
   * month after — `ceil((lead + length) / 7)` weeks. Each cell counts the
   * `marks` (day keys, any order, repeats counted) that fall on it.
   */
  monthGrid(
    monthDay: DayKey,
    days: readonly DayOffset[],
    marks: readonly DayKey[],
  ): readonly CalendarWeek[] {
    const year = Number(monthDay.slice(0, 4));
    const month = Number(monthDay.slice(5, 7));
    const length = DayKey.daysInMonth(year, month);
    const first = DayKey.epochDayOf(year, month, 1);
    const lead = weekdayOf(DayKey.fromEpochDay(first), days) - Weekday.Mon;
    const cellCount =
      Math.ceil((lead + length) / DAYS_PER_WEEK) * DAYS_PER_WEEK;

    const counts = new Map<string, number>();
    for (let i = 0; i < marks.length; i++) {
      const key = marks[i] as DayKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // The grid starts on a Monday by construction (`first - lead`), so cell
    // `i` is weekday Mon + i mod 7; the day of the month is a counter that
    // starts in the month before and resets on the 1st of this one and of
    // the next — no table lookup and no substring per cell.
    const previousLength =
      month === 1
        ? DayKey.daysInMonth(year - 1, 12)
        : DayKey.daysInMonth(year, month - 1);
    let dayOfMonth = previousLength - lead + 1;
    const weeks: CalendarWeek[] = [];
    let week: CalendarCell[] = [];
    for (let i = 0; i < cellCount; i++) {
      const epochDay = first - lead + i;
      if (epochDay === first || epochDay === first + length) dayOfMonth = 1;
      const dayKey = DayKey.fromEpochDay(epochDay);
      week.push({
        dayKey,
        weekday: (Weekday.Mon + (i % DAYS_PER_WEEK)) as Weekday,
        dayOfMonth,
        inMonth: epochDay >= first && epochDay < first + length,
        marks: counts.get(dayKey) ?? 0,
      });
      dayOfMonth += 1;
      if (week.length === DAYS_PER_WEEK) {
        weeks.push(week);
        week = [];
      }
    }
    return weeks;
  },
} as const;
