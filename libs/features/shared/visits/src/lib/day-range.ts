import { LocalDate, defect } from '@core/primitives';
import { formatWallClockRange } from '@creativo/ui/wall-clock';

/*
 * THE HOUSE DATE RANGE — a span of shop days as the locale's own range,
 * the one formatter a list or a card prints one with: a season's window
 * «1.09 – 30.11», a waiting request's days «8.10 – 9.10» or «чт – пт».
 *
 * `Intl`'s `formatRange` owns the separator (the spaced en dash) and the
 * pieces the two ends share; its output is never post-processed, so no
 * list writes a hand-built «8.10–9.10» beside a card's «1.09 – 30.11»
 * (wave D r6). A day is a `YYYY-MM-DD` key on the shop's calendar, laid on
 * the civil axis and read back in UTC (`formatWallClockRange`, the one
 * cached formatter), so no device zone can move it and no `Date` is built.
 */

/**
 * How the range names its days: the date, the house fact-line form (R59,
 * «8.10»), or the short weekday («чт») a list uses inside the coming week.
 * Both ends always take the same face — `Intl` formats a range with one
 * set of options.
 */
export type DayRangeFace = 'date' | 'weekday';

/**
 * «1.09 – 30.11» · «8.10 – 9.10» · «чт – пт» — the house range. A date
 * range names the years only when an end falls outside `today`'s
 * («1.06 – 31.08.2025 г.»); an unknown `today` names none, as a single date
 * does — though a range that itself crosses a year names both, `Intl`'s own
 * call («30.12.2026 г. – 2.01.2027 г.»).
 */
export function dayRange(
  from: string,
  until: string,
  today: string | null,
  lang: string,
  face: DayRangeFace = 'date',
): string {
  const options: Intl.DateTimeFormatOptions =
    face === 'weekday'
      ? { weekday: 'short' }
      : {
          day: 'numeric',
          month: '2-digit',
          ...(today === null ||
          (yearOf(from) === yearOf(today) && yearOf(until) === yearOf(today))
            ? {}
            : { year: 'numeric' }),
        };
  return formatWallClockRange(dayOf(from), dayOf(until), lang, options);
}

/** A `YYYY-MM-DD` shop day as the brand; anything else is a caller's defect. */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`not a shop day: ${raw}`);
}

function yearOf(day: string): string {
  return day.slice(0, 4);
}
