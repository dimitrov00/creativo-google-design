/** ISO weekday numbers, Monday first — the tag source of {@link Weekday}. */
const ISO_WEEKDAY = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
} as const;

/**
 * ISO weekday, `1` = Monday … `7` = Sunday — the ONE dictionary
 * `LocalDate.weekday` answers, `DayHours` (indexed `weekday − 1`) and
 * `ShiftSegment.weekday` read. A number, so it indexes a seven-entry array
 * directly and a Mon-first week sorts by value.
 */
export type Weekday = (typeof ISO_WEEKDAY)[keyof typeof ISO_WEEKDAY];

export const Weekday = {
  ...ISO_WEEKDAY,

  isWeekend(day: Weekday): boolean {
    return day === ISO_WEEKDAY.Sat || day === ISO_WEEKDAY.Sun;
  },
} as const;
