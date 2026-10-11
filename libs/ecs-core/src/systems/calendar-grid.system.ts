import { DateRange } from '@core/components';
import { Weekday, LocalDate } from '@core/primitives';

const DAYS_PER_WEEK = 7;

/** One day of a month grid — the month's own, or a neighbour's padding it. */
export type CalendarCell = {
  readonly localDate: LocalDate;
  /** ISO 1..7 (`LocalDate.weekday`). */
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

/**
 * CalendarGridSystem — a Monday-first month grid padded to whole weeks
 * (`client/appointments/src/lib/calendar-month.ts`, `client-appointments.ts`
 * `buildMonth`, the month picker; the booking builders are wired by their
 * own group). Shop days and counts only (Law 7.3, flatten-spec T1): no zone,
 * no `Intl`, no `Date`, no day table — a weekday is a property of the civil
 * day, the same in every zone (`LocalDate.weekday`), so a grid drawn across
 * a DST transition is the grid of any other month. The Monday of a week is
 * `LocalDate.startOfWeek`. "Today" is a comparison of local dates in the
 * template, not a grid fact.
 */
export const CalendarGridSystem = {
  /**
   * The days a month's grid shows: the Monday on or before its 1st through
   * the Sunday on or after its last day. `monthDay` is any day of the month.
   */
  gridRange(monthDay: LocalDate): DateRange {
    const { year, month } = LocalDate.parts(monthDay);
    const first = LocalDate.epochDayOf(year, month, 1);
    const last = first + LocalDate.daysInMonth(year, month) - 1;
    const lead = LocalDate.weekday(LocalDate.fromEpochDay(first)) - Weekday.Mon;
    const trail = Weekday.Sun - LocalDate.weekday(LocalDate.fromEpochDay(last));
    return DateRange.of(
      LocalDate.fromEpochDay(first - lead),
      LocalDate.fromEpochDay(last + trail),
    );
  },

  /**
   * The month of `monthDay` as whole weeks, Monday first: the leading days
   * of the month before, every day of the month, the trailing days of the
   * month after — `ceil((lead + length) / 7)` weeks. Each cell counts the
   * `marks` (shop days, any order, repeats counted) that fall on it.
   */
  monthGrid(
    monthDay: LocalDate,
    marks: readonly LocalDate[],
  ): readonly CalendarWeek[] {
    const { year, month } = LocalDate.parts(monthDay);
    const length = LocalDate.daysInMonth(year, month);
    const first = LocalDate.epochDayOf(year, month, 1);
    const lead = LocalDate.weekday(LocalDate.fromEpochDay(first)) - Weekday.Mon;
    const cellCount =
      Math.ceil((lead + length) / DAYS_PER_WEEK) * DAYS_PER_WEEK;

    const counts = new Map<LocalDate, number>();
    for (let i = 0; i < marks.length; i++) {
      const day = marks[i] as LocalDate;
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    // The grid starts on a Monday by construction (`first - lead`), so cell
    // `i` is weekday Mon + i mod 7; the day of the month is a counter that
    // starts in the month before and resets on the 1st of this one and of
    // the next — no lookup and no substring per cell.
    const previousLength =
      month === 1
        ? LocalDate.daysInMonth(year - 1, 12)
        : LocalDate.daysInMonth(year, month - 1);
    let dayOfMonth = previousLength - lead + 1;
    const weeks: CalendarWeek[] = [];
    let week: CalendarCell[] = [];
    for (let i = 0; i < cellCount; i++) {
      const epochDay = first - lead + i;
      if (epochDay === first || epochDay === first + length) dayOfMonth = 1;
      const localDate = LocalDate.fromEpochDay(epochDay);
      week.push({
        localDate,
        weekday: (Weekday.Mon + (i % DAYS_PER_WEEK)) as Weekday,
        dayOfMonth,
        inMonth: epochDay >= first && epochDay < first + length,
        marks: counts.get(localDate) ?? 0,
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
