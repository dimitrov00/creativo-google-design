import type { LocalDate, Locale } from '@core/primitives';
import { formatWallClock } from '@creativo/ui/wall-clock';

/*
 * THE TEAM SCREENS' SHARED WORDING HELPERS (Law 10): how a quiet line of
 * facts is joined and how a day is said. Pure; one copy for the list's and
 * the member page's presenters.
 */

/**
 * The no-break space: inside a fact («31 дек.», «3 от 5») so it is one word
 * to the line breaker, and BEFORE a separator, so a quiet line that wraps
 * ends its first line on the «·».
 */
export const NBSP = ' ';

/** A quiet line of facts: each one word to the line breaker, «·» between. */
export function lineOf(facts: readonly string[]): string {
  return facts.map((fact) => fact.replaceAll(' ', NBSP)).join(`${NBSP}· `);
}

/** «31 дек.» · «31 дек. 2027 г.» — a day in a quiet line, the year only outside `today`'s. */
export function dayWords(
  day: LocalDate,
  today: LocalDate | null,
  locale: Locale,
): string {
  const sameYear = today !== null && day.slice(0, 4) === today.slice(0, 4);
  return formatWallClock(day, null, locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The first word of a name — what a line calls the person («Николай»). */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
