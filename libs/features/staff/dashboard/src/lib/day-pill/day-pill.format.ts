import { LocalDate } from '@core/primitives';
import {
  formatWallClock,
  formatWallClockRange,
  wallClockParts,
} from '@creativo/ui/wall-clock';

/**
 * `ср, 9.09` — the one grammar for a day named in a pill, COMPACT, exactly
 * as `Intl` renders the locale's short date (owner, 2026-09-09: "keep it how
 * Intl produces it", then "the compact version"). The weekday leads because
 * in a barbershop a Saturday is not a Tuesday. `month: 'short'` is numeric
 * in Bulgarian by CLDR (`9.09`) and a word in English (`Sep 9`); neither is
 * touched afterwards — no capitaliser, no padding.
 */
export function formatDayPill(day: LocalDate, locale: string): string {
  return formatWallClock(day, null, locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * «21 – 27.09» — a PERIOD in the pill's own numeric grammar (2026-09-23,
 * the grid views' design record §9).
 *
 * The 3-day and week labels were written in the long month («23 – 25
 * Септември») for a headline segment that no longer exists; in the pill
 * that string pushed the search and the chair picker off a 390px bar. The
 * single-day form is numeric by the 2026-09-04 ruling (the two pickers may
 * differ in density, never in facts), so the range takes the same pieces.
 *
 * Inside one month the shared month is said ONCE, on whichever side the
 * locale puts it: Bulgarian writes the day first («21 – 27.09»), English
 * the month («Sep 21 – 27») — read off `formatToParts` rather than
 * assumed. Across a month or a year `Intl`'s own `formatRange` writes the
 * pair («30.09 – 2.10», «28.12.2026 г. – 3.01.2027 г.»); nothing here
 * invents a separator the locale would not.
 */
export function formatDayPillRange(
  first: LocalDate,
  last: LocalDate,
  locale: string,
): string {
  const from = LocalDate.parts(first);
  const to = LocalDate.parts(last);
  const sameYear = from.year === to.year;
  const sameMonth = sameYear && from.month === to.month;
  const dayMonth: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  };
  if (!sameMonth) {
    return formatWallClockRange(
      first,
      last,
      locale,
      sameYear ? dayMonth : { ...dayMonth, year: 'numeric' },
    );
  }
  const parts = wallClockParts(last, null, locale, dayMonth);
  const dayLeads =
    parts.findIndex((part) => part.type === 'day') <
    parts.findIndex((part) => part.type === 'month');
  const dayOnly: Intl.DateTimeFormatOptions = { day: 'numeric' };
  return dayLeads
    ? `${formatWallClock(first, null, locale, dayOnly)} – ${formatWallClock(last, null, locale, dayMonth)}`
    : `${formatWallClock(first, null, locale, dayMonth)} – ${formatWallClock(last, null, locale, dayOnly)}`;
}
