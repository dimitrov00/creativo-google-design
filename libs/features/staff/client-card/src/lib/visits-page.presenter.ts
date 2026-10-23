import { HistoryNote } from '@core/components';
import type { ClientStatsRecord } from '@core/entities';
import {
  ClientStatsSystem,
  VisitFilter,
  VisitGrain,
  VisitListSystem,
  VisitPerspective,
} from '@core/systems';
import { LoadState, PagingState } from '@creativo/shared/view-state';
import {
  type VisitRowVm,
  type VisitSectionVm,
  matchesVisitFilter,
  offeredVisitFilters,
  sectionVisits,
  visitRowOf,
  visitSectionLabel,
  workedVisitsDetail,
} from '@creativo/features/shared/visits';
import {
  type FactMark,
  LINE_JOINT,
  dayWithYear,
  factRun,
  figure,
  joined,
  quietRun,
  runsOf,
  unbroken,
} from './client-card.format';
import type {
  HistoryCellVm,
  HistoryPagingVm,
  HistorySpendVm,
  LinePart,
  VisitsPageVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';
import {
  type HistoryRowsInput,
  cadenceWeeks,
  historyCells,
  historyNoteWords,
} from './history.presenter';

/*
 * «ПОСЕЩЕНИЯ», REVISION 3 (client-card-revision-3 §2.5, R2-I) — the staff
 * history as the client's own «Часове»: the title, the facts under it, the
 * month pills, the list. The body under the facts is the shared browser
 * (`lib-visits-browser`), so this file builds what only a barber reads and
 * nothing of the list's look: the rows by MONTH (the shared builder's, staff
 * perspective), the two quiet lines that took the stats band's place
 * (DV-D), the funnel's options and the list's foot.
 *
 * NEW BESIDE BUILT (§7.0, rule 5): `history.presenter.ts` words the page
 * that is on screen until its body is re-drawn, by year; what holds for
 * both (`historyCells`, `cadenceWeeks`, `HistoryRowsInput`) is imported
 * from it, never copied.
 */

/** The family the page's test ids belong to: `history-upcoming`, `history-month-2026-09` (R17). */
const TEST_ID_PREFIX = 'history';

// ── The rows and the sections ───────────────────────────────────────────

/**
 * Every loaded visit as a staff row filed by MONTH, each visit once (pages
 * never overlap, but a refresh may): the tile says the weekday over the
 * day, the face keeps the trailing edge and the staff's fact ends the
 * second line (`trailingFact`).
 */
export function visitsRows(input: HistoryRowsInput): readonly VisitRowVm[] {
  const { now, timeZone } = input;
  if (now === null || timeZone === null) return [];
  return VisitListSystem.distinctById(input.appointments).map((appointment) =>
    visitRowOf(
      appointment,
      {
        perspective: VisitPerspective.Staff,
        grain: VisitGrain.Month,
        subjectUserId: input.subjectUserId,
        subjectCustomerId: input.subjectCustomerId,
        currentAppointmentId: input.currentAppointmentId,
        now,
        timeZone,
        locale: input.words.lang,
        photoCount: input.photoCounts.get(appointment.id) ?? 0,
        words: input.words.visits,
        clientWords: input.clientWords,
      },
      input.catalog,
    ),
  );
}

/**
 * HF–HH — the rows the filter keeps, under «Предстоящи» and then the
 * months, newest first. A month's heading counts its worked visits only
 * from two up: by month a barber's cadence files one row under most
 * headings, and «1 посещение» over one row says what the row already does.
 * A month nobody came in has no section, so the pills are a map of when
 * this person actually came.
 */
export function visitsSections(
  rows: readonly VisitRowVm[],
  filter: VisitFilter,
  words: ClientCardWords,
): readonly VisitSectionVm[] {
  return sectionVisits(
    rows.filter((row) => matchesVisitFilter(row, filter)),
    {
      grain: VisitGrain.Month,
      testIdPrefix: TEST_ID_PREFIX,
      labels: {
        upcoming: words.visitsModule.upcoming,
        section: (key) => visitSectionLabel(key, words.lang),
        detail: workedVisitsDetail(words.visitsModule.sectionVisits),
      },
    },
  );
}

// ── The quiet lines ─────────────────────────────────────────────────────

/*
 * The grammar is the card's (`client-card.format.ts`): `runsOf` finds a
 * fact where the words put it, `unbroken` holds a line's words together
 * but after its joints, `joined` folds neighbours of one ink. Drawn, the
 * page parts the line's runs at `LINE_JOINT` into the items of a line of
 * facts (`fact-line.css`): a line that wraps neither ends nor opens on a
 * dot.
 */

/** What the page says over the list before it knows anything: nothing, never an empty frame. */
interface VisitsHead {
  readonly line: readonly LinePart[];
  readonly lineName: string;
  readonly facts: readonly LinePart[] | null;
  readonly cells: readonly HistoryCellVm[];
}

const NOTHING_SAID: VisitsHead = {
  line: [],
  lineName: '',
  facts: null,
  cells: [],
};

/**
 * HB — «**23** посещения · през **4** седмици», the figures in primary
 * ink; no-shows and the client's cancellations join only when there are
 * some («· **2** неявявания»). Before the first worked visit the line is
 * «Първо посещение», and the visits' own figure leaves the cells with it:
 * a zero is not a fact of this person's.
 *
 * HC — what is left to say: «Без неявявания и откази от клиента» over a
 * clean record, and the ‹admin›'s sum. Nothing on record has neither: a
 * first visit has no record to call clean and nothing was paid yet.
 */
function headOf(
  stats: ClientStatsRecord | null,
  spend: HistorySpendVm | null,
  words: ClientCardWords,
): VisitsHead {
  const lang = words.lang;
  const visits = stats?.lifetimeVisitsCompleted ?? 0;
  // FIRST_VISIT before the first worked visit, CLEAN over a clean record.
  const note = ClientStatsSystem.historyNote(stats);
  const weeks =
    stats?.avgCadenceDays == null ? null : cadenceWeeks(stats.avgCadenceDays);
  const cells = historyCells(stats, words).filter(
    (cell) => visits > 0 || cell.id !== 'visits',
  );
  const risks = cells.filter(
    (cell) => cell.id === 'noShows' || cell.id === 'cancelled',
  );
  const spoken = risks
    .map((cell) => `, ${cell.value} ${cell.caption}`)
    .join('');
  const drawn = risks.flatMap((cell) => [
    quietRun(LINE_JOINT),
    factRun(cell.value),
    quietRun(` ${cell.caption}`),
  ]);

  if (note === HistoryNote.FirstVisit) {
    return {
      line: joined(unbroken([quietRun(words.head.firstVisit), ...drawn])),
      lineName: `${words.head.firstVisit}${spoken}`,
      facts: null,
      cells,
    };
  }

  const counted = words.visitsModule.sectionVisits(visits);
  const count: FactMark = { slot: counted, fact: figure(visits, lang) };
  // A cadence needs three worked visits (R34): until then the count alone.
  let lead = runsOf(counted, [count]);
  if (weeks !== null) {
    const cadence = words.head.cadence(weeks);
    lead = runsOf(words.history.line(counted, cadence), [
      count,
      { slot: cadence, fact: figure(weeks, lang) },
    ]);
  }

  return {
    line: joined(unbroken([...lead, ...drawn])),
    lineName: words.history.statsName(
      counted,
      weeks === null ? '' : words.history.statsInterval(weeks),
      spoken,
    ),
    facts: factsOf(historyNoteWords(note, words), spend, words),
    cells,
  };
}

/**
 * HC's runs. Alone, the sum is its own sentence («Похарчени общо
 * 492,50 €»); after the note it runs on in the line's case («… ·
 * похарчени общо 492,50 €»). The figure is the fact either way, and the
 * sum's few words never part: at 390 the line breaks after the note's
 * joint, not before a figure left alone on the second line.
 */
function factsOf(
  note: string | null,
  spend: HistorySpendVm | null,
  words: ClientCardWords,
): readonly LinePart[] | null {
  if (spend === null) return note === null ? null : [quietRun(note)];
  const sum: FactMark = { slot: spend.value, fact: spend.value };
  return note === null
    ? unbroken(runsOf(spend.sentence, [sum]))
    : joined([
        quietRun(`${note}${LINE_JOINT}`),
        ...unbroken(runsOf(words.history.spendInline(spend.value), [sum])),
      ]);
}

// ── The page ────────────────────────────────────────────────────────────

/** What `visitsPageVm` takes: the first page's read, the loaded pages, the choice, the record. */
export interface VisitsPageInput {
  /** The first page's read: `LOADING`, `READY` or `FAILED` (never `EMPTY`). */
  readonly loadState: LoadState;
  readonly rows: HistoryRowsInput;
  readonly filter: VisitFilter;
  readonly stats: ClientStatsRecord | null;
  /** The ‹admin›'s sum (`historyFacts(…).spend`); `null` for anyone else: never probed. */
  readonly spend: HistorySpendVm | null;
  /** The list's foot (`visitsPaging`); `null` offline with a cursor left. */
  readonly paging: HistoryPagingVm | null;
}

/**
 * The options of the funnel, the choice in force always among them
 * (`VisitListSystem.offeredWith`): a narrowed list can always be widened
 * again, and the menu never opens on a choice it does not list (a filter
 * picked while older pages remained, which the last page then left
 * without a row).
 */
function offeredOf(
  offered: readonly VisitFilter[],
  inForce: VisitFilter,
): readonly VisitFilter[] {
  return VisitListSystem.offeredWith(VisitPerspective.Staff, offered, inForce);
}

/**
 * The page before its words, or before its subject: the read's state and
 * the choice, nothing said. What the store answers while the catalogue is
 * still on its way.
 */
export function visitsPageBlank(
  loadState: LoadState,
  filter: VisitFilter,
): VisitsPageVm {
  return {
    loadState,
    ...NOTHING_SAID,
    filter,
    offeredFilters: offeredOf([VisitFilter.All], filter),
    sections: [],
    paging: null,
  };
}

/**
 * «Посещения» (§2.5): two quiet lines, then the shared browser's input.
 *
 * The lines are the RECORD's (`clientStats`), the list is the READ's: a
 * list that is loading or failed draws no row, no foot and no option but
 * the way back to «Всички», and the lines still say what the record
 * knows. Without a record the lines wait with the list (nobody is told
 * «Първо посещение» by a read that has not answered); once the list is
 * read, no record IS the answer.
 *
 * The terminal options stay on offer while older pages remain (one of
 * them may hold the outcome), so the list is complete exactly when its
 * foot says `end`.
 */
export function visitsPageVm(input: VisitsPageInput): VisitsPageVm {
  const words = input.rows.words;
  const ready = input.loadState === LoadState.Ready;
  const head =
    ready || input.stats !== null
      ? headOf(input.stats, input.spend, words)
      : NOTHING_SAID;
  if (!ready) {
    return { ...visitsPageBlank(input.loadState, input.filter), ...head };
  }

  const rows = visitsRows(input.rows);
  const sections = visitsSections(rows, input.filter, words);
  const paging = input.paging;
  return {
    loadState: LoadState.Ready,
    ...head,
    filter: input.filter,
    offeredFilters: offeredOf(
      offeredVisitFilters(VisitPerspective.Staff, rows, {
        complete: paging?.pagingState === PagingState.End,
      }),
      input.filter,
    ),
    sections,
    // A list with no row ends on nothing: a closing line under the empty
    // state would close a list that is not there.
    paging:
      paging?.pagingState === PagingState.End && sections.length === 0
        ? { pagingState: PagingState.End, endLabel: null }
        : paging,
  };
}

// ── The list's foot ─────────────────────────────────────────────────────

/** What `visitsPaging` reads of the store's pages. */
export interface VisitsPagingInput {
  /** The next page's cursor (the start instant it reads before); `null` once the last page is read. */
  readonly cursor: number | null;
  /** The «Покажи още» read; `MORE` while idle — the end is the `null` cursor. */
  readonly pagingState: Exclude<PagingState, typeof PagingState.End>;
  readonly online: boolean;
  readonly stats: ClientStatsRecord | null;
  readonly words: ClientCardWords;
}

/**
 * HI/HJ — the list's foot: «Покажи още» while a cursor remains (absent
 * offline: a read that cannot answer), its busy and failed states, and at
 * the end the fact the list was walked down to, «Първо посещение:
 * 6.03.2025 г.», the year always named. Before the first worked visit
 * the end is «Това е първото посещение.»; a record that does not know its
 * first day ends on nothing.
 */
export function visitsPaging(input: VisitsPagingInput): HistoryPagingVm | null {
  if (input.pagingState === PagingState.Loading) {
    return { pagingState: PagingState.Loading, endLabel: null };
  }
  if (input.cursor !== null) {
    if (!input.online) return null;
    return {
      pagingState:
        input.pagingState === PagingState.Failed
          ? PagingState.Failed
          : PagingState.More,
      endLabel: null,
    };
  }
  const history = input.words.history;
  const visits = input.stats?.lifetimeVisitsCompleted ?? 0;
  const first = input.stats?.firstVisitLocalDate ?? null;
  return {
    pagingState: PagingState.End,
    endLabel:
      visits === 0
        ? history.onlyThisVisit
        : first === null
          ? null
          : history.first(dayWithYear(first, input.words.lang)),
  };
}
