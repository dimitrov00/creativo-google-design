import {
  type AppointmentId,
  type BookingStatus,
  LocalDate,
  type LocationId,
  type MinuteOfDay,
} from '@core/primitives';
import {
  BookingLifecycle,
  ShopNow,
  VisitFilter,
  VisitGrain,
  VisitPerspective,
  VisitRowOutcome,
  WallTime,
} from '@core/components';

/** The upcoming run's key — not a date, so it can never collide with one (a key, not a tag). */
const UPCOMING_SECTION_KEY = 'upcoming';

/**
 * A row as sectioning reads it: where it starts on the shop's wall clock
 * (Law 7.3, T1 — a list is ordered by shop day and minute, never by an
 * instant).
 */
export type SectionRow = {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  /** The dated section the row files under (`2026-09` / `2026`), or the upcoming key. */
  readonly sectionKey: string;
  readonly upcoming: boolean;
};

/** A row as the funnel reads it; `null` is a row with no outcome yet (a waiting request). */
export type FilterRow = {
  readonly upcoming: boolean;
  readonly outcome: VisitRowOutcome | null;
};

/**
 * A visit as "upcoming" reads it ({@link VisitListSystem.nextUpcoming}): its
 * id (the tie-break, OR-18), its lifecycle tag, the shop whose wall clock
 * judges it, and where it starts on that clock — a whole `Appointment`
 * passes in as it is.
 */
export type UpcomingVisit = {
  readonly id: AppointmentId;
  readonly bookingStatus: BookingStatus;
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};

/** One section of a list: its key and its rows, in the section's own order. */
export type VisitSection<R extends SectionRow> = {
  readonly key: string;
  /** The upcoming run — the one section that is a promise, not a record. */
  readonly upcoming: boolean;
  readonly rows: readonly R[];
};

/**
 * What a row's date tile names over its day ({@link VisitListSystem.tileGrain},
 * OR-56 b): what the heading of its section does not.
 */
export type TileGrain = {
  /**
   * The caption names the month — under a year's heading, and in the
   * upcoming run, whose heading names no period at all. False under a
   * month's heading, which names the month and its year: the caption is
   * the weekday.
   */
  readonly namesMonth: boolean;
};

/** Under a month's heading («Септември 2026 г.»): the weekday, «пт». */
const TILE_WEEKDAY: TileGrain = { namesMonth: false };

/**
 * Under a year's heading («2026») and in the upcoming run («Предстоящи»):
 * the month, «септ.». Never the year (DEP-F39): the tile is a 44 pt square
 * that cannot hold «юни 2030 г.», an upcoming visit lies within the booking
 * horizon so its month is unambiguous, and the row's accessible name keeps
 * the year (R59).
 */
const TILE_MONTH: TileGrain = { namesMonth: true };

/**
 * The fewest sections a jump rail is drawn for (OR-56 c): one pill alone
 * names the one section its heading names right under it.
 */
const PILLS_AT_LEAST = 2;

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

/** Where an item starts on the shop's wall clock — what {@link byStart} reads. */
type WallClockStart = {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};

/** Wall-clock order: the shop day, then the minute inside it. */
function byStart(a: WallClockStart, b: WallClockStart): number {
  return (
    LocalDate.compare(a.localDate, b.localDate) ||
    a.startMinutes - b.startMinutes
  );
}

function soonestFirst(a: SectionRow, b: SectionRow): number {
  return byStart(a, b) || byId(a, b);
}

function newestFirst(a: SectionRow, b: SectionRow): number {
  return byStart(b, a) || byId(a, b);
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
   * year — from the shop day it falls on (its `localDate`, the shop's own
   * calendar), so a visit at 00:30 on the 1st is never filed under the
   * month before.
   */
  sectionKeyOf(localDate: LocalDate, grain: VisitGrain): string {
    return grain === VisitGrain.Year
      ? localDate.slice(0, 4)
      : localDate.slice(0, 7);
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

  /**
   * The options with the choice in force always among them, in the menu's
   * order: a narrowed list can always be widened again, and the menu never
   * opens on a choice it does not list (a filter picked while older pages
   * remained, which the last page then left without a row). `offered`
   * itself when it already holds the choice.
   */
  offeredWith(
    perspective: VisitPerspective,
    offered: readonly VisitFilter[],
    inForce: VisitFilter,
  ): readonly VisitFilter[] {
    if (offered.includes(inForce)) return offered;
    const options = VisitListSystem.filtersFor(perspective);
    const out: VisitFilter[] = [];
    for (let f = 0; f < options.length; f++) {
      const filter = options[f] as VisitFilter;
      if (filter === inForce || offered.includes(filter)) out.push(filter);
    }
    return out;
  },

  /**
   * The section a visit's row files under: the upcoming run while the hour
   * is still to come, else its dated section ({@link sectionKeyOf}).
   */
  rowSectionKey(
    upcoming: boolean,
    localDate: LocalDate,
    grain: VisitGrain,
  ): string {
    return upcoming
      ? UPCOMING_SECTION_KEY
      : VisitListSystem.sectionKeyOf(localDate, grain);
  },

  /**
   * THE TILE'S GRAIN (OR-56 b) — what a row's date tile names over its day,
   * by the section the row files under ({@link rowSectionKey}): what that
   * section's heading does not. Under a month's heading the weekday; under
   * a year's the month; in the upcoming run, whose heading («Предстоящи»)
   * names no period, the month too — never the year, which the square
   * cannot hold (DEP-F39; the row's accessible name keeps it, R59). An
   * upcoming row once read «сб / 1» for 1 June 2030 — the month was nowhere
   * on the row.
   */
  tileGrain(upcoming: boolean, grain: VisitGrain): TileGrain {
    if (upcoming) return TILE_MONTH;
    return grain === VisitGrain.Year ? TILE_MONTH : TILE_WEEKDAY;
  },

  /**
   * Does the list's jump rail show (OR-56 c)? Over two sections or more:
   * a pill jumps to its section, and a rail of one pill names the one
   * section its heading names right under it — «Предстоящи» over
   * «Предстоящи», one fact printed twice, with nowhere to jump. No rail
   * over no section either.
   */
  showsPills(sections: readonly { readonly key: string }[]): boolean {
    return sections.length >= PILLS_AT_LEAST;
  },

  /**
   * Each appointment once, by its id — the first copy wins and the input's
   * order is kept (pages never overlap, but a refresh may).
   */
  distinctById<A extends { readonly id: AppointmentId }>(
    appointments: readonly A[],
  ): readonly A[] {
    const seen = new Set<AppointmentId>();
    const out: A[] = [];
    for (let i = 0; i < appointments.length; i++) {
      const appointment = appointments[i] as A;
      if (seen.has(appointment.id)) continue;
      seen.add(appointment.id);
      out.push(appointment);
    }
    return out;
  },

  /**
   * The items whose row is upcoming, soonest first on the shop's wall clock
   * — the day, then the minute — each row read once (`rowOf`). Two items at
   * the same day and minute break the tie by their row's id in UTF-16 code
   * units (`byStart || byId`, OR-18 — the order of {@link sections}'
   * upcoming run), so the input's order never shows in the output (DEP-F13:
   * only exact ties reorder). No inbound mapping: the caller hands its items
   * and its row reading as they are.
   */
  upcomingSoonestFirst<T>(
    items: readonly T[],
    rowOf: (item: T) => SectionRow,
  ): readonly T[] {
    const kept: { readonly item: T; readonly row: SectionRow }[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const row = rowOf(item);
      if (row.upcoming) kept.push({ item, row });
    }
    kept.sort((a, b) => soonestFirst(a.row, b.row));
    const out: T[] = [];
    for (let i = 0; i < kept.length; i++) {
      out.push((kept[i] as { readonly item: T }).item);
    }
    return out;
  },

  /**
   * Has the visit begun: its start on the shop's wall clock at or before
   * the shop's "now" (`WallTime.compare ≤ 0` against `ShopNow.wallTime`,
   * T1 — never an instant). THE one "has the visit begun" rule in ecs-core,
   * the list's and the story's alike (homed here because the list composes
   * it, {@link isHistory}). NOT `!VisitStorySystem.isUpcoming`: at the start
   * minute a visit has begun AND is still filed upcoming — two questions.
   */
  hasStarted(start: WallTime, now: ShopNow): boolean {
    return WallTime.compare(start, ShopNow.wallTime(now)) <= 0;
  },

  /**
   * Does a visit of the history READ enter the history — settled
   * (`BookingLifecycle.isSettled`: completed, cancelled, no-show), or
   * begun ({@link hasStarted}: its start at or before the shop's "now", the
   * start minute included)? Admission, not filing: the page still files
   * each admitted row by its own start (`VisitStorySystem.isUpcoming`), so
   * a visit at its start minute is admitted here and shown upcoming there.
   * The whole appointment passes straight in.
   */
  isHistory(
    appointment: {
      readonly bookingStatus: BookingStatus;
      readonly localDate: LocalDate;
      readonly startMinutes: MinuteOfDay;
    },
    now: ShopNow,
  ): boolean {
    return (
      BookingLifecycle.isSettled(appointment) ||
      VisitListSystem.hasStarted(
        WallTime.of(appointment.localDate, appointment.startMinutes),
        now,
      )
    );
  },

  /**
   * THE NEXT VISIT TO COME (OR-8) — «Предстоящ час»: the soonest visit that
   * is not history ({@link isHistory}: settled, or begun — its start minute
   * included), each judged on its OWN shop's wall clock (`nowOf` its
   * `locationId`, Law 7.2 — never the device's, never one shop's clock for
   * all). A visit whose shop has no known zone (`nowOf` answers `null`) is
   * skipped: it cannot be judged, and showing it would claim it is still to
   * come. One linear scan, no sort and no copy; on an equal day and minute
   * the code-unit smaller id wins (OR-18 — the order the upcoming list's
   * {@link upcomingSoonestFirst} draws, so the card and the list's first
   * row never disagree, whatever the input's order). `null` when nothing
   * is to come.
   */
  nextUpcoming<T extends UpcomingVisit>(
    items: readonly T[],
    nowOf: (locationId: LocationId) => ShopNow | null,
  ): T | null {
    let next: T | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const now = nowOf(item.locationId);
      if (now === null || VisitListSystem.isHistory(item, now)) continue;
      if (next === null) {
        next = item;
        continue;
      }
      const order = byStart(item, next);
      if (order < 0 || (order === 0 && item.id < next.id)) next = item;
    }
    return next;
  },

  /**
   * How many visits are still to come — the menu badge's figure, by the
   * rule of {@link nextUpcoming} (not history on its own shop's clock; an
   * unknown zone skipped). One linear scan.
   */
  countUpcoming(
    items: readonly UpcomingVisit[],
    nowOf: (locationId: LocationId) => ShopNow | null,
  ): number {
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as UpcomingVisit;
      const now = nowOf(item.locationId);
      if (now !== null && !VisitListSystem.isHistory(item, now)) count++;
    }
    return count;
  },
} as const;
