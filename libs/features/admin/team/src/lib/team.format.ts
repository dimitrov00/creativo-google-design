import type { Role } from '@core/components';
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

/**
 * «Администратор, Рецепция» — the roles a line may name, in the order the
 * words table names them (`TeamWords.roles`); a role with no word there is
 * not said.
 */
export function rolesLine(
  roles: readonly Role[],
  named: ReadonlyMap<Role, string>,
): string {
  const said: string[] = [];
  for (const [role, word] of named) {
    if (roles.includes(role)) said.push(word);
  }
  return said.join(', ');
}

/** A quiet line of the facts that are there; `null` for none. */
export function factsLine(facts: readonly string[]): string | null {
  const said = facts.filter((fact) => fact.length > 0);
  return said.length === 0 ? null : lineOf(said);
}

/** The first word of a name — what a line calls the person («Николай»). */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
