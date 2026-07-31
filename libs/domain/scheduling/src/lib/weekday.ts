import { CalendarDay } from './calendar-day';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** ISO order — Monday first, matching `ZonedDateTime.weekday` (1…7). */
export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * ISO weekday number (1 = Monday … 7 = Sunday) → the literal.
 *
 * This bridge exists because the two halves of the model legitimately
 * disagree on representation: a recurring pattern reads far better in a
 * Firestore document as `'monday'` than as `1`, while instants carry the ISO
 * number. Converting in exactly one place is how the two stay consistent —
 * `Location.hours` being a positional 7-tuple and `WorkingHours` being a
 * string map is the drift this prevents spreading.
 */
export function weekdayFromIso(iso: number): Weekday {
  return WEEKDAYS[iso - 1] as Weekday;
}

export function weekdayOf(day: CalendarDay): Weekday {
  return weekdayFromIso(day.weekday());
}

/** Position in `Location.hours`, which is a Mon-first 7-tuple. */
export function isoOf(weekday: Weekday): number {
  return WEEKDAYS.indexOf(weekday) + 1;
}
