import type { DayKey } from '../components/day-key.data';

/** The grain a visit list is sectioned by — the ONLY source of these strings. */
export const VisitGrain = {
  Month: 'month',
  Year: 'year',
} as const;
export type VisitGrain = (typeof VisitGrain)[keyof typeof VisitGrain];

/** A row's own outcome, as a list narrows by it — the ONLY source of these strings. */
export const VisitRowOutcome = {
  Open: 'open',
  Worked: 'worked',
  NoShow: 'no_show',
  Cancelled: 'cancelled',
} as const;
export type VisitRowOutcome =
  (typeof VisitRowOutcome)[keyof typeof VisitRowOutcome];

/** The funnel's options — the ONLY source of these strings. */
export const VisitFilter = {
  All: 'all',
  Upcoming: 'upcoming',
  Completed: 'completed',
  Cancelled: 'cancelled',
  NoShow: 'no_show',
} as const;
export type VisitFilter = (typeof VisitFilter)[keyof typeof VisitFilter];

/** Who reads the list — the ONLY source of these strings. */
export const VisitPerspective = {
  Client: 'client',
  Staff: 'staff',
} as const;
export type VisitPerspective =
  (typeof VisitPerspective)[keyof typeof VisitPerspective];

/** The upcoming run's key — not a date, so it can never collide with one. */
const UPCOMING_SECTION_KEY = 'upcoming';

/** A row as sectioning reads it. */
export type SectionRow = {
  readonly id: string;
  readonly startMs: number;
  /** The dated section the row files under (`2026-09` / `2026`), or the upcoming key. */
  readonly sectionKey: string;
  readonly upcoming: boolean;
};

/** A row as the funnel reads it; `null` is a row with no outcome yet (a waiting request). */
export type FilterRow = {
  readonly upcoming: boolean;
  readonly outcome: VisitRowOutcome | null;
};

/** One section of a list: its key and its rows, in the section's own order. */
export type VisitSection<R extends SectionRow> = {
  readonly key: string;
  /** The upcoming run — the one section that is a promise, not a record. */
  readonly upcoming: boolean;
  readonly rows: readonly R[];
};

/** The client's list, as it always read. */
const CLIENT_FILTERS: readonly VisitFilter[] = [
  VisitFilter.All,
  VisitFilter.Upcoming,
  VisitFilter.Completed,
  VisitFilter.Cancelled,
  VisitFilter.NoShow,
];

/** The staff history: the record's two exceptions side by side, no-shows first. */
const STAFF_FILTERS: readonly VisitFilter[] = [
  VisitFilter.All,
  VisitFilter.Upcoming,
  VisitFilter.Completed,
  VisitFilter.NoShow,
  VisitFilter.Cancelled,
];

/** The id breaks a tie, so the input's order never shows in the output. */
function byId(a: SectionRow, b: SectionRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function soonestFirst(a: SectionRow, b: SectionRow): number {
  return a.startMs - b.startMs || byId(a, b);
}

function newestFirst(a: SectionRow, b: SectionRow): number {
  return b.startMs - a.startMs || byId(a, b);
}

function newestKeyFirst(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * VisitListSystem — THE LIST'S SECTIONS AND ITS FUNNEL
 * (`libs/features/shared/visits/src/lib/visit-sections.ts`,
 * `visit-filter.ts`), so «Моите часове» and the staff card's history file
 * and narrow a visit the same way. Keys, rows and counts — the headings and
 * the option words are the template's.
 */
export const VisitListSystem = {
  UPCOMING_SECTION_KEY,

  /**
   * The dated section a visit files under — `2026-09` by month, `2026` by
   * year — from the day it falls on, on its OWN calendar (the day key comes
   * from the shop zone's table), so a visit at 00:30 on the 1st is never
   * filed under the month before.
   */
  sectionKeyOf(dayKey: DayKey, grain: VisitGrain): string {
    return grain === VisitGrain.Year ? dayKey.slice(0, 4) : dayKey.slice(0, 7);
  },

  /**
   * Rows into sections: the upcoming run first, soonest first; then the
   * dated sections newest first, each newest first — the id breaking ties.
   * A period with no visit gets NO section. A row files where it says (its
   * `sectionKey`); by year, a month key folds into its year.
   */
  sections<R extends SectionRow>(
    rows: readonly R[],
    grain: VisitGrain,
  ): readonly VisitSection<R>[] {
    const upcoming: R[] = [];
    const dated = new Map<string, R[]>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as R;
      if (row.upcoming || row.sectionKey === UPCOMING_SECTION_KEY) {
        upcoming.push(row);
        continue;
      }
      const key =
        grain === VisitGrain.Year ? row.sectionKey.slice(0, 4) : row.sectionKey;
      const bucket = dated.get(key);
      if (bucket) bucket.push(row);
      else dated.set(key, [row]);
    }
    const sections: VisitSection<R>[] = [];
    if (upcoming.length > 0) {
      sections.push({
        key: UPCOMING_SECTION_KEY,
        upcoming: true,
        rows: upcoming.sort(soonestFirst),
      });
    }
    const keys = [...dated.keys()].sort(newestKeyFirst);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      sections.push({
        key,
        upcoming: false,
        rows: (dated.get(key) as R[]).sort(newestFirst),
      });
    }
    return sections;
  },

  /** How many of the rows were WORKED — a cancellation and a no-show are rows, not visits. */
  workedCount(rows: readonly FilterRow[]): number {
    let worked = 0;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] as FilterRow).outcome === VisitRowOutcome.Worked) worked++;
    }
    return worked;
  },

  /**
   * A dated heading's figure: the worked visits of the section, and only
   * from `atLeast` of them up (never below one — nothing worked is never a
   * figure); `null` below the floor.
   */
  workedFigure(rows: readonly FilterRow[], atLeast: number): number | null {
    const worked = VisitListSystem.workedCount(rows);
    return worked >= Math.max(1, atLeast) ? worked : null;
  },

  /** The options, in the order each menu offers them. */
  filtersFor(perspective: VisitPerspective): readonly VisitFilter[] {
    return perspective === VisitPerspective.Staff
      ? STAFF_FILTERS
      : CLIENT_FILTERS;
  },

  /**
   * Does the row stay under this filter? On the row's OWN outcome.
   * `upcoming` is the run ahead, a waiting request included; every terminal
   * filter is about the past, so an upcoming row never matches one, nor
   * does a past hour nobody settled.
   */
  matches(row: FilterRow, filter: VisitFilter): boolean {
    switch (filter) {
      case VisitFilter.All:
        return true;
      case VisitFilter.Upcoming:
        return row.upcoming;
      case VisitFilter.Completed:
        return !row.upcoming && row.outcome === VisitRowOutcome.Worked;
      case VisitFilter.NoShow:
        return !row.upcoming && row.outcome === VisitRowOutcome.NoShow;
      case VisitFilter.Cancelled:
        return !row.upcoming && row.outcome === VisitRowOutcome.Cancelled;
    }
  },

  /**
   * The options worth offering over the rows a list holds, in the menu's
   * order: each one that NARROWS the list — some row answers it and some row
   * does not. `all` always stays. While older pages remain (`complete`
   * false) the three terminal options stay; «Предстоящи» is the first
   * read's to answer, so it goes as soon as no row is upcoming.
   */
  offered(
    perspective: VisitPerspective,
    rows: readonly FilterRow[],
    complete: boolean,
  ): readonly VisitFilter[] {
    const options = VisitListSystem.filtersFor(perspective);
    const out: VisitFilter[] = [];
    for (let f = 0; f < options.length; f++) {
      const filter = options[f] as VisitFilter;
      if (filter === VisitFilter.All) {
        out.push(filter);
        continue;
      }
      if (!complete && filter !== VisitFilter.Upcoming) {
        out.push(filter);
        continue;
      }
      let answered = false;
      let misses = false;
      for (let i = 0; i < rows.length; i++) {
        if (VisitListSystem.matches(rows[i] as FilterRow, filter)) {
          answered = true;
        } else {
          misses = true;
        }
        if (answered && misses) break;
      }
      if (answered && (!complete || misses)) out.push(filter);
    }
    return out;
  },
} as const;
