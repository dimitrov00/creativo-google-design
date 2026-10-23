import {
  type FilterRow,
  VisitFilter,
  VisitListSystem,
  VisitPerspective,
} from '@core/systems';
import { visitFilterWords } from '@creativo/infrastructure/i18n';

/*
 * THE FUNNEL'S RULE (client-card redesign §5.3.1) — moved out of
 * `client-appointments.ts`, where it lived as two `computed`s over two
 * reads, so the client's list and the staff card's history narrow the same
 * way, over rows already built.
 *
 * `all` and `upcoming` are the two axes a person actually thinks in; the
 * three terminal outcomes are there because a history is where you go
 * looking for "did I ever no-show?" — and each is an outcome the row
 * genuinely carries, so no option can ever be a lie.
 *
 * The options, their order and the narrowing rule are `VisitListSystem`
 * in `@core/systems`, over its own tags and the rows as they are (a row IS
 * a `FilterRow`); the option's key is built here from its one lower-case
 * word (`visitFilterWords`).
 */

/**
 * The options, in the order each menu offers them: the client's list as it
 * always read, the staff history as its spec lists them (§3.6 HD) — the
 * record's two exceptions side by side, no-shows first.
 */
export function visitFiltersFor(
  perspective: VisitPerspective,
): readonly VisitFilter[] {
  return VisitListSystem.filtersFor(perspective);
}

/**
 * The option's word (`visits.filter.*`). One word differs by who reads it:
 * a client «Пропуснати» their own hour, a barber records a «Неявявания».
 */
export function visitFilterWordKey(
  filter: VisitFilter,
  perspective: VisitPerspective,
): string {
  if (filter === VisitFilter.NoShow && perspective === VisitPerspective.Staff) {
    return 'visits.filter.no_show_staff';
  }
  // eslint-disable-next-line security/detect-object-injection -- `filter` is a member of the closed dictionary the table is total over.
  return `visits.filter.${visitFilterWords[filter]}`;
}

/**
 * The options worth offering over the rows a list holds, in the menu's
 * order: each one that NARROWS the list, so some row answers it and some
 * row does not. The rest are absent, never disabled (client-card redesign
 * §3.0). A funnel never offers «Неявявания» under a band that says there
 * are none. Nor does it offer «Минали» over a book where every visit
 * worked and none is ahead, since picking it would change nothing (wave D
 * r3). `all` always stays, so a host hides its funnel when `all` is all
 * there is. While older pages remain (`complete` false) a past outcome may
 * still be among them, so the three terminal options stay until the list
 * has been read to its end. «Предстоящи» is the first read's to answer
 * (§3.6: no second query), so it goes as soon as no row is upcoming; an
 * older page is a past hour, so until the end it narrows whenever a row
 * answers it.
 */
export function offeredVisitFilters(
  perspective: VisitPerspective,
  rows: readonly FilterRow[],
  options: { readonly complete: boolean },
): readonly VisitFilter[] {
  return VisitListSystem.offered(perspective, rows, options.complete);
}

/**
 * Does the row stay under this filter? On the row's OWN outcome — the
 * subject's on the staff card (a companion's no-show is not the booker's),
 * the appointment's on the client's list.
 *
 * `upcoming` is the run ahead, a waiting request included. Every terminal
 * filter is by definition about the past, so an upcoming row — an open
 * hour, never an outcome yet — never matches one; nor does a past hour
 * nobody settled, which is none of the three.
 */
export function matchesVisitFilter(
  row: FilterRow,
  filter: VisitFilter,
): boolean {
  return VisitListSystem.matches(row, filter);
}
