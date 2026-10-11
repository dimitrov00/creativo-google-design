import { VisitListSystem } from '@creativo/ecs-core';
import {
  LEGACY_VISIT_FILTER,
  VISIT_FILTER_OF,
  VISIT_PERSPECTIVE_OF,
  filterRowOf,
} from './visit-ecs.shim';
import type { VisitFilter, VisitPerspective, VisitRowVm } from './visit-row.vm';

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
 * Phase 2 shim: the options, their order and the narrowing rule are
 * `VisitListSystem` in `@creativo/ecs-core`; the option words stay here.
 * Flatten pass: the system's tags are SCREAMING; the legacy words are
 * converted at this boundary (`visit-ecs.shim.ts`).
 */

/** Each reader's options in the legacy words, built once — a stable array per reader. */
const FILTERS_FOR: Readonly<Record<VisitPerspective, readonly VisitFilter[]>> =
  {
    client: VisitListSystem.filtersFor(VISIT_PERSPECTIVE_OF.client).map(
      (filter) => LEGACY_VISIT_FILTER[filter],
    ),
    staff: VisitListSystem.filtersFor(VISIT_PERSPECTIVE_OF.staff).map(
      (filter) => LEGACY_VISIT_FILTER[filter],
    ),
  };

/**
 * The options, in the order each menu offers them: the client's list as it
 * always read, the staff history as its spec lists them (§3.6 HD) — the
 * record's two exceptions side by side, no-shows first.
 */
export function visitFiltersFor(
  perspective: VisitPerspective,
): readonly VisitFilter[] {
  return FILTERS_FOR[perspective];
}

/**
 * The option's word (`visits.filter.*`). One word differs by who reads it:
 * a client «Пропуснати» their own hour, a barber records a «Неявявания».
 */
export function visitFilterWordKey(
  filter: VisitFilter,
  perspective: VisitPerspective,
): string {
  return filter === 'no_show' && perspective === 'staff'
    ? 'visits.filter.no_show_staff'
    : `visits.filter.${filter}`;
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
  rows: readonly VisitRowVm[],
  options: { readonly complete: boolean },
): readonly VisitFilter[] {
  return VisitListSystem.offered(
    VISIT_PERSPECTIVE_OF[perspective],
    rows.map(filterRowOf),
    options.complete,
  ).map((filter) => LEGACY_VISIT_FILTER[filter]);
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
  row: VisitRowVm,
  filter: VisitFilter,
): boolean {
  return VisitListSystem.matches(filterRowOf(row), VISIT_FILTER_OF[filter]);
}
