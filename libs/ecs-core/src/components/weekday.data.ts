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
 * `DayOffset.weekday`, `DayHours` (indexed `weekday − 1`) and
 * `ShiftSegment.weekday` read. A number, so it indexes a seven-entry array
 * directly and a Mon-first week sorts by value.
 */
export type Weekday = (typeof ISO_WEEKDAY)[keyof typeof ISO_WEEKDAY];

export const Weekday = {
  ...ISO_WEEKDAY,

  isWeekend(day: Weekday): boolean {
    return day === ISO_WEEKDAY.Sat || day === ISO_WEEKDAY.Sun;
  },

  /**
   * The ISO weekday of a civil epoch day (days since 1970-01-01, which was a
   * Thursday). Integer arithmetic, so no consumer ever constructs a `Date`
   * for a weekday; correct for negative epoch days too.
   */
  ofEpochDay(epochDay: number): Weekday {
    return (((((epochDay + 3) % 7) + 7) % 7) + 1) as Weekday;
  },
} as const;
