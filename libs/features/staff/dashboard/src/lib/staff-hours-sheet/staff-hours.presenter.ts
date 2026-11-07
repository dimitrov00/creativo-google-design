import type { MinuteRange } from '@core/components';
import { type TrackMinute, Weekday } from '@core/primitives';
import { type RosterWeek, RosterWeekSystem } from '@core/systems';
import { ClockClosing, formatClock } from '@creativo/ui/wall-clock';
import type { HoursDayVm, HoursWords } from './staff-hours.vm';

/** The week's days in the sheet's order, Monday first. */
export const HOURS_WEEK: readonly Weekday[] = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
  Weekday.Sat,
  Weekday.Sun,
];

/** The `HH:mm` face of a minute — a shift that ends at midnight reads «00:00». */
export function hoursClock(minute: TrackMinute): string {
  return formatClock(minute, ClockClosing.Wrap);
}

/** «09:00–13:00, 14:00–18:00». */
export function rangesLabel(ranges: readonly MinuteRange[]): string {
  return ranges
    .map(
      (range) =>
        `${hoursClock(range.startMinutes)}–${hoursClock(range.endMinutes)}`,
    )
    .join(', ');
}

/**
 * THE WEEK, WORDED — one row per weekday, Monday first: its shifts or
 * «Почивен», and its breaks under them. The week is the system's
 * (`RosterWeekSystem.dayOf`); this only says it.
 */
export function hoursWeekVm(
  week: RosterWeek,
  words: HoursWords,
): readonly HoursDayVm[] {
  return HOURS_WEEK.map((weekday) => {
    const day = RosterWeekSystem.dayOf(week, weekday);
    const off = day.shifts.length === 0;
    const name = words.weekday(weekday);
    const hours = off ? words.off : rangesLabel(day.shifts);
    const breaks =
      off || day.breaks.length === 0
        ? null
        : words.breakLine(rangesLabel(day.breaks));
    return {
      weekday,
      name,
      hours,
      breaks,
      off,
      accessibleName: [name, hours, breaks]
        .filter((part): part is string => part !== null)
        .join(', '),
    };
  });
}
