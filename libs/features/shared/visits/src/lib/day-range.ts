import { LocalDate } from '@core/primitives';
import { formatWallClockRange } from '@creativo/ui/wall-clock';

/*
 * THE HOUSE DATE RANGE — a span of shop days as the locale's own range,
 * the one formatter a list or a card prints one with: a season's window
 * «1.09 – 30.11», a waiting request's days «8.10 – 9.10» or «чт – пт».
 *
 * `Intl`'s `formatRange` owns the separator (the spaced en dash) and the
 * pieces the two ends share; its output is never post-processed, so no
 * list writes a hand-built «8.10–9.10» beside a card's «1.09 – 30.11»
 * (wave D r6). A day is the shop's `LocalDate` (Law 7.3), laid on the civil
 * axis and read back in UTC (`formatWallClockRange`, the one cached
 * formatter), so no device zone can move it and no `Date` is built.
 */

/**
 * How the range names its days: the date, the house fact-line form (R59,
 * «8.10»), or the short weekday («чт») a list uses inside the coming week.
 * Both ends always take the same face — `Intl` formats a range with one
 * set of options. Values kept as the face's own spelling (pass D, D-8.8:
 * a face parameter whose compare reads the dictionary).
 */
export const DayRangeFace = {
  Date: 'date',
  Weekday: 'weekday',
} as const;
export type DayRangeFace = (typeof DayRangeFace)[keyof typeof DayRangeFace];

/**
 * «1.09 – 30.11» · «8.10 – 9.10» · «чт – пт» — the house range. A date
 * range names the years only when an end falls outside `today`'s
 * («1.06 – 31.08.2025 г.»); an unknown `today` names none, as a single date
 * does — though a range that itself crosses a year names both, `Intl`'s own
 * call («30.12.2026 г. – 2.01.2027 г.»).
 */
export function dayRange(
  from: LocalDate,
  until: LocalDate,
  today: LocalDate | null,
  lang: string,
  face: DayRangeFace = DayRangeFace.Date,
): string {
  const options: Intl.DateTimeFormatOptions =
    face === DayRangeFace.Weekday
      ? { weekday: 'short' }
      : {
          day: 'numeric',
          month: '2-digit',
          ...(today === null ||
          (yearOf(from) === yearOf(today) && yearOf(until) === yearOf(today))
            ? {}
            : { year: 'numeric' }),
        };
  return formatWallClockRange(from, until, lang, options);
}

/** A shop day's calendar year (`LocalDate.parts`). */
function yearOf(day: LocalDate): number {
  return LocalDate.parts(day).year;
}
