import type { BarberId } from '@core/primitives';

/*
 * THE DAY'S HEALTH ROWS (OR-2) — the display model: what one all-day row
 * prints for a chair whose day the sheet could not read in full. Types and
 * the row kinds' test ids only (Law 10.3); `day-health.presenter.ts` fills
 * them.
 *
 * A row is an all-day EVENT of the chair, built from the off row's parts
 * (`.agenda-card--allday`): the chair's tone in the disc, an error glyph in
 * it, the chair's name in semibold (a partial read's count under it), what
 * to do or what went wrong in the trailing meta — never interactive (there
 * is nothing to open), announced as a status.
 */

/** The hook a row kind carries for the page's specs and the e2e journeys. */
export const DayHealthTestId = {
  /** The chair's day could not be read at all — `staff.day.laneFailedBadge`. */
  Failed: 'staff-lane-failed',
  /** Some of the chair's visits could not be read — `staff.day.unreadable.*`. */
  Unreadable: 'staff-lane-unreadable',
} as const;
export type DayHealthTestId =
  (typeof DayHealthTestId)[keyof typeof DayHealthTestId];

/** One chair's health row, as the all-day strip prints it. */
export interface DayHealthRowVm {
  readonly barberId: BarberId;
  /** «Иван» — the chair, in semibold where the off row names its barber. */
  readonly name: string;
  /**
   * The second line under the name: «2 посещения не могат да се покажат»
   * for a partial read — the count stays in sight — and `null` for a failed
   * chair, which read no visits to count.
   */
  readonly detail: string | null;
  /** The chair's identity tone — the disc's tint, as on every card of the chair. */
  readonly tone: number;
  /**
   * The trailing column, where a card writes its clock time: «Не се зареди»
   * for a failed chair, «Презареди страницата» — what to do — for a partial
   * read (`staff.day.unreadableHint`, the row's meta, OR-2).
   */
  readonly meta: string;
  /**
   * The row's whole sentence for a screen reader, read after the name — the
   * failure AND what to do about it: «Този график не се зареди — презареди
   * страницата.», «2 посещения не могат да се покажат. Презареди
   * страницата.».
   */
  readonly label: string;
  readonly testId: DayHealthTestId;
}

/** A chair as the rows name it: its name and its tone. */
export interface DayHealthChair {
  readonly name: string;
  readonly tone: number;
}

/** The catalogue's words for the rows, read once (`dayHealthWordsOf`). */
export interface DayHealthWords {
  /**
   * «{{count}} посещение не може да се покаже» / «… посещения не могат да се
   * покажат» — `staff.day.unreadable.<form>`, the CLDR form chosen for the
   * count.
   */
  readonly unreadable: (count: number) => string;
  /** «Презареди страницата» — `staff.day.unreadableHint`. */
  readonly unreadableHint: string;
  /** «Не се зареди» — `staff.day.laneFailedBadge`, beside `staff.day.offBadge`. */
  readonly laneFailedBadge: string;
  /** «Този график не се зареди — презареди страницата.» — `staff.day.laneFailed`. */
  readonly laneFailed: string;
}
