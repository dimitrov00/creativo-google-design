import { ZonedDateTime } from '@creativo/application/booking';
import { DayKey, VisitListSystem } from '@creativo/ecs-core';
import type { VisitGrain, VisitRowVm, VisitSectionVm } from './visit-row.vm';

/*
 * THE LIST'S SECTIONS (client-card redesign §5.3.2) — moved out of the
 * client's `visit-vm.ts` (`groupVisitsByMonth`, `monthKeyOf`) so «Моите
 * часове» and the staff card's history file a visit the same way.
 *
 * What changed on the way: the grain. The client reads months, a barber
 * read years (DV2: at a four-weekly cadence a month section averages one
 * row). And the label always carries the year — the old heading was the
 * month alone, so a history reaching back past a year drew TWO «Юли»
 * sections, a year apart, under the same word.
 *
 * Since revision 3 (R2-I) both screens read MONTHS: the staff card's
 * «Посещения» is the client's screen, and the jump pills make its length
 * walkable. The year grain stays for a future dense list.
 *
 * Phase 2 shim: the sectioning, the section key and the worked figure are
 * `VisitListSystem` in `@creativo/ecs-core`; the headings' words, the
 * figure's word and the test ids stay here.
 */

/** The upcoming run's key — not a date, so it can never collide with one. */
export const UPCOMING_SECTION_KEY: string =
  VisitListSystem.UPCOMING_SECTION_KEY;

/** The words a list's headings take; the host reads them from the catalogue. */
export interface VisitSectionLabels {
  /** «Предстоящи» (`appointments.sections.upcoming`). */
  readonly upcoming: string;
  /** A dated section's heading — `visitSectionLabel` for the house form. */
  readonly section: (key: string) => string;
  /**
   * The heading's trailing figure — the staff history's «9 посещения», the
   * worked visits in the section, null at zero. Asked of dated sections
   * only: the upcoming run is a promise, not a record. Absent: no figure
   * anywhere (the client's list).
   */
  readonly detail?: (rows: readonly VisitRowVm[]) => string | null;
}

export interface VisitSectionOptions {
  readonly grain: VisitGrain;
  readonly labels: VisitSectionLabels;
  /**
   * The family the sections' test ids belong to: `{prefix}-upcoming`,
   * `{prefix}-year-2026`, `{prefix}-month-2026-09` — the staff history's
   * `history-*` (R17). Defaults to `visits`.
   */
  readonly testIdPrefix?: string;
}

/**
 * A dated heading's figure, as both visit screens print it since revision
 * 3 (§2.5): the WORKED visits of the section, «3 посещения», and only from
 * `atLeast` of them up. By month a barber-cadence history is mostly
 * one-row sections, and «1 посещение» on every heading says what the one
 * row under it already does: a month of one visit is its heading alone.
 * By year the figure is a fact from the first visit on (`atLeast: 1`).
 *
 * The host hands the word (`visits.section.visits.*`, the count's plural
 * form its own); this is the `detail` of `VisitSectionLabels`.
 */
export function workedVisitsDetail(
  word: (count: number) => string,
  atLeast = 2,
): (rows: readonly VisitRowVm[]) => string | null {
  return (rows) => {
    const worked = VisitListSystem.workedFigure(rows, atLeast);
    return worked === null ? null : word(worked);
  };
}

/**
 * The dated section a visit files under — `2026-09` by month, `2026` by
 * year — on its OWN calendar (the shop's zone travels with the instant), so
 * a visit at 00:30 on the 1st is never filed under the month before.
 */
export function visitSectionKey(
  start: ZonedDateTime,
  grain: VisitGrain,
): string {
  return VisitListSystem.sectionKeyOf(DayKey.of(start.toISODate()), grain);
}

/**
 * A dated section's heading, in the house form (R59): a month with its
 * year — «Септември 2026 г.», capitalised because a heading is not prose
 * (Bulgarian writes months lowercase in a sentence) — or the year alone,
 * «2026». `Intl` output is otherwise untouched, its « г.» included.
 */
export function visitSectionLabel(key: string, locale: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (!month) return key;
  // Mid-month at noon: no zone's offset can move it into another month.
  const noon = ZonedDateTime.fromParts(
    {
      year: Number(month[1]),
      month: Number(month[2]),
      day: 15,
      hour: 12,
      minute: 0,
    },
    'UTC',
  );
  if (noon.isFailure()) return key;
  const label = noon.value.toLocaleString(locale, {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

/**
 * Rows into sections: the upcoming run first, soonest first; then the dated
 * sections newest first, each newest first. A period with no visit gets NO
 * section — the headings (and the client's jump pills) are a map of when
 * this person actually came, not a calendar.
 *
 * A row files where it says (`sectionKey`, set by the builder in the shop's
 * zone); a list sectioned by year folds a month key into its year, so rows
 * built for either grain section correctly by year.
 */
export function sectionVisits(
  rows: readonly VisitRowVm[],
  options: VisitSectionOptions,
): readonly VisitSectionVm[] {
  const prefix = options.testIdPrefix ?? 'visits';
  return VisitListSystem.sections(rows, options.grain).map((section) =>
    section.upcoming
      ? {
          key: section.key,
          label: options.labels.upcoming,
          detail: null,
          rows: section.rows,
          testId: `${prefix}-${UPCOMING_SECTION_KEY}`,
        }
      : {
          key: section.key,
          label: options.labels.section(section.key),
          detail: options.labels.detail?.(section.rows) ?? null,
          rows: section.rows,
          testId: `${prefix}-${options.grain}-${section.key}`,
        },
  );
}
