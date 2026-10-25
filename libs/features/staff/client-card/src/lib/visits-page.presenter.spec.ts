import type { ClientStatsRecord } from '@core/entities';
import { VisitFilter, VisitRowOutcome } from '@core/components';
import { AppointmentId, UserId } from '@core/primitives';
import {
  TrailingFactFace,
  type VisitRowVm,
  type VisitSectionVm,
} from '@creativo/features/shared/visits';
import { LoadState, PagingState } from '@creativo/shared/view-state';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ClientCardWords } from './client-card.words';
import type {
  HistoryPagingVm,
  LinePart,
  VisitsPageVm,
} from './client-pages.vm';
import { type HistoryRowsInput, historyFacts } from './history.presenter';
import {
  type VisitsPageInput,
  type VisitsPagingInput,
  visitsPageBlank,
  visitsPageVm,
  visitsPaging,
  visitsRows,
  visitsSections,
} from './visits-page.presenter';
import {
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_MONEY,
  GEORGI_NEXT_ID,
  GEORGI_NOTE,
  MARTIN,
  MARTIN_CUSTOMER_ID,
  MARTIN_TODAY_ID,
  NBSP_EURO,
  NOW,
  SHOP_CATALOG,
  SHOP_TIME_ZONE,
  georgiHistory,
  martinHistory,
  sofia,
  statsOf,
  wordsOf,
} from '../testing/client-card.fixtures';

/*
 * «ПОСЕЩЕНИЯ», REVISION 3 (client-card-revision-3 §2.5) — the presenter
 * over the dev shop's two books and the app's own catalogue: Георги Петров
 * (24 worked visits since 6.03.2025, today's fade done, one hour ahead)
 * and Мартин Илиев (13 cuts, the shop's one cancellation, in the chair).
 */

const WORDS = wordsOf('bg');
const EN = wordsOf('en');

/** A space a line never breaks at. */
const NB = '\u00a0';

/** The quiet lines' joint: a no-break space before the middot, a plain one after. */
const J = `${NB}· `;

/** A word joiner: it draws nothing and lets no line break where it stands. */
const WJ = '\u2060';

/**
 * A fact's words as a quiet line holds them: none of their spaces breaks,
 * but the one after a middot, and a hyphen holds its word together.
 */
const held = (words: string): string =>
  words
    .replaceAll(' ', NB)
    .replaceAll(`·${NB}`, '· ')
    .replaceAll('-', `-${WJ}`);

/** The space before «г.» in a month heading: narrow and no-break, the formatter's own. */
const YEAR_SPACE = '\u202f';

const GEORGI_BOOK = georgiHistory();
const GEORGI_STATS = statsOf(GEORGI, GEORGI_BOOK);
const MARTIN_BOOK = martinHistory();
const MARTIN_STATS = statsOf(MARTIN, MARTIN_BOOK);

/** The ‹admin›'s sum as the store hands it over. */
const SPEND = historyFacts(GEORGI_STATS, GEORGI_MONEY, WORDS).spend;

function georgiInput(
  overrides: Partial<HistoryRowsInput> = {},
): HistoryRowsInput {
  return {
    appointments: GEORGI_BOOK,
    subjectUserId: UserId.of(GEORGI),
    subjectCustomerId: GEORGI_CUSTOMER_ID,
    currentAppointmentId: AppointmentId.of('appt-dev-1'),
    now: NOW,
    timeZone: SHOP_TIME_ZONE,
    photoCounts: new Map([[AppointmentId.of('appt-hist-c1-23'), 1]]),
    clientWords: true,
    catalog: SHOP_CATALOG,
    words: WORDS,
    ...overrides,
  };
}

function martinInput(
  overrides: Partial<HistoryRowsInput> = {},
): HistoryRowsInput {
  return georgiInput({
    appointments: MARTIN_BOOK,
    subjectUserId: UserId.of(MARTIN),
    subjectCustomerId: MARTIN_CUSTOMER_ID,
    currentAppointmentId: MARTIN_TODAY_ID,
    photoCounts: new Map(),
    ...overrides,
  });
}

const END: HistoryPagingVm = {
  pagingState: PagingState.End,
  endLabel: 'Първо посещение: 6.03.2025 г.',
};
const MORE: HistoryPagingVm = {
  pagingState: PagingState.More,
  endLabel: null,
};

function page(overrides: Partial<VisitsPageInput> = {}): VisitsPageVm {
  return visitsPageVm({
    loadState: LoadState.Ready,
    rows: georgiInput(),
    filter: VisitFilter.All,
    stats: GEORGI_STATS,
    spend: null,
    paging: END,
    ...overrides,
  });
}

/** The record with some lifetime counts changed — its flat `lifetime*` fields (Law 6). */
function withLifetime(
  stats: ClientStatsRecord,
  lifetime: Partial<{
    readonly visitsCompleted: number;
    readonly noShows: number;
    readonly clientCancels: number;
  }>,
): ClientStatsRecord {
  return {
    ...stats,
    lifetimeVisitsCompleted:
      lifetime.visitsCompleted ?? stats.lifetimeVisitsCompleted,
    lifetimeNoShows: lifetime.noShows ?? stats.lifetimeNoShows,
    lifetimeClientCancels:
      lifetime.clientCancels ?? stats.lifetimeClientCancels,
  };
}

/** No first visit on the record (its day and minute are `null` together, N9). */
const NO_FIRST_VISIT = {
  firstVisitLocalDate: null,
  firstVisitStartMinutes: null,
} as const;

/** Before the first worked visit: a record that counts nothing yet. */
const NEW_CLIENT: ClientStatsRecord = {
  ...withLifetime(GEORGI_STATS, { visitsCompleted: 0 }),
  avgCadenceDays: null,
  ...NO_FIRST_VISIT,
};

const text = (line: readonly LinePart[] | null): string =>
  (line ?? []).map((part) => part.text).join('');
const factsIn = (line: readonly LinePart[] | null): readonly string[] =>
  (line ?? []).filter((part) => part.fact).map((part) => part.text);
const rowsOf = (sections: readonly VisitSectionVm[]): readonly VisitRowVm[] =>
  sections.flatMap((section) => section.rows);

describe('the rows, by month', () => {
  it('files a visit under its month, the weekday on its tile, the face trailing and the staff’s fact on the second line', () => {
    const rows = new Map(visitsRows(georgiInput()).map((row) => [row.id, row]));
    expect(rows.get(AppointmentId.of('appt-hist-c1-23'))).toMatchObject({
      sectionKey: '2026-09',
      upcoming: false,
      // The section says the month and the year: the tile says the rest.
      tile: { caption: 'чт', day: 3, tone: 'past' },
      title: 'Фейд',
      lines: [{ text: 'Център · Иван', hold: ' · Иван' }],
      quote: `„${GEORGI_NOTE}“`,
      trailing: {
        avatarSrc: 'https://example.test/barbers/ivan.jpg',
        name: 'Иван',
        several: false,
      },
      trailingFact: {
        trailingFactFace: TrailingFactFace.Amount,
        text: NBSP_EURO('17,50 €'),
        emphasis: 'primary',
        struck: false,
      },
      marks: [{ icon: 'client.photos', label: '1 снимка', count: 1 }],
      testId: 'history-row-appt-hist-c1-23',
    });
  });

  it('marks the visit the sheet is open on «Този час», wherever its date files it', () => {
    const rows = visitsRows(georgiInput());
    expect(rows.find((row) => row.id === 'appt-dev-1')).toMatchObject({
      sectionKey: '2026-09',
      tile: { caption: 'пн', day: 28, tone: 'past' },
      lines: [{ text: '10:00 · Иван' }],
      trailingFact: {
        trailingFactFace: TrailingFactFace.Badge,
        text: 'Този час',
      },
    });
    // An hour ahead, confirmed: the face alone, no fact to end the line.
    expect(rows.find((row) => row.id === GEORGI_NEXT_ID)).toMatchObject({
      sectionKey: 'upcoming',
      upcoming: true,
      tile: { caption: 'пт', day: 2, tone: 'upcoming' },
      trailing: { name: 'Иван' },
      trailingFact: null,
    });
  });

  it('strikes an hour that did not happen, its booked price struck beside it', () => {
    const rows = visitsRows(martinInput());
    expect(rows.find((row) => row.id === 'appt-hist-c2-11')).toMatchObject({
      sectionKey: '2026-05',
      struck: true,
      tile: { tone: 'hollow' },
      lines: [{ text: 'Отказан от салона · Нико' }],
      trailing: { name: 'Нико' },
      trailingFact: {
        trailingFactFace: TrailingFactFace.Amount,
        text: NBSP_EURO('15,00 €'),
        emphasis: 'secondary',
        struck: true,
      },
    });
  });

  it('counts each visit once, however the pages overlap', () => {
    const rows = visitsRows(
      georgiInput({
        appointments: [...GEORGI_BOOK, ...GEORGI_BOOK.slice(0, 3)],
      }),
    );
    expect(rows).toHaveLength(GEORGI_BOOK.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(GEORGI_BOOK.length);
  });

  it('keeps the client’s own words from a sysadmin (R15)', () => {
    const row = visitsRows(georgiInput({ clientWords: false })).find(
      (it) => it.id === 'appt-hist-c1-23',
    );
    expect(row?.quote).toBeNull();
    expect(row?.accessibleName).not.toContain(GEORGI_NOTE);
  });

  it('tells each row for the subject it is handed: the client’s own words only where the subject booked', () => {
    const own = visitsRows(martinInput()).find(
      (row) => row.id === MARTIN_TODAY_ID,
    );
    expect(own?.quote).toBe('„Къса отстрани“');
    // The same book on someone else's card (a party member's): the words
    // are the booker's, and stay off the row.
    const rows = visitsRows(martinInput({ subjectUserId: UserId.of(GEORGI) }));
    expect(rows).toHaveLength(MARTIN_BOOK.length);
    expect(rows.every((row) => row.quote === null)).toBe(true);
  });
});

describe('the sections', () => {
  it('opens with the run ahead, then the months newest first, under the history’s ids', () => {
    const sections = visitsSections(
      visitsRows(georgiInput()),
      VisitFilter.All,
      WORDS,
    );
    expect(
      sections
        .slice(0, 4)
        .map((s) => [s.key, s.label, s.detail, s.testId, s.rows.length]),
    ).toEqual([
      ['upcoming', 'Предстоящи', null, 'history-upcoming', 1],
      [
        '2026-09',
        `Септември 2026${YEAR_SPACE}г.`,
        '2 посещения',
        'history-month-2026-09',
        2,
      ],
      [
        '2026-08',
        `Август 2026${YEAR_SPACE}г.`,
        null,
        'history-month-2026-08',
        1,
      ],
      ['2026-07', `Юли 2026${YEAR_SPACE}г.`, null, 'history-month-2026-07', 1],
    ]);
    const months = sections.slice(1).map((section) => section.key);
    expect(months.every((key) => /^\d{4}-\d{2}$/.test(key))).toBe(true);
    expect(months).toEqual([...months].sort().reverse());
    expect(months.at(-1)).toBe('2025-03');
    expect(rowsOf(sections)).toHaveLength(GEORGI_BOOK.length);
    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.sectionKey).toBe(section.key);
        expect(row.testId).toBe(`history-row-${row.id}`);
      }
    }
  });

  it('counts a month’s worked visits from two up: a month of one visit is its heading alone', () => {
    const sections = visitsSections(
      visitsRows(georgiInput()),
      VisitFilter.All,
      WORDS,
    );
    for (const section of sections.slice(1)) {
      const worked = section.rows.filter(
        (row) => row.outcome === VisitRowOutcome.Worked,
      ).length;
      expect(section.detail).toBe(worked >= 2 ? `${worked} посещения` : null);
    }
    expect(sections.filter((section) => section.detail !== null)).not.toEqual(
      [],
    );
  });

  it('never counts an hour that did not happen, and draws no month nobody came in', () => {
    const sections = visitsSections(
      visitsRows(martinInput()),
      VisitFilter.All,
      WORDS,
    );
    // May 2026: one cut and the shop's cancellation.
    const may = sections.find((section) => section.key === '2026-05');
    expect(may?.rows.map((row) => row.outcome)).toEqual([
      VisitRowOutcome.Worked,
      VisitRowOutcome.Cancelled,
    ]);
    expect(may?.detail).toBeNull();
    // Nothing in June 2026 or January 2026: no heading, so no pill.
    const keys = sections.map((section) => section.key);
    expect(keys).not.toContain('2026-06');
    expect(keys).not.toContain('2026-01');
    // In the chair, not ahead: today files under its month.
    expect(keys).not.toContain('upcoming');
    expect(sections[0]?.rows[0]).toMatchObject({
      id: MARTIN_TODAY_ID,
      trailingFact: {
        trailingFactFace: TrailingFactFace.Badge,
        text: 'Този час',
      },
    });
  });

  it('narrows to the subject’s own outcome, and to nothing when no row answers', () => {
    const rows = visitsRows(martinInput());
    const cancelled = visitsSections(rows, VisitFilter.Cancelled, WORDS);
    expect(cancelled.map((s) => [s.key, s.detail, s.rows.length])).toEqual([
      ['2026-05', null, 1],
    ]);
    expect(cancelled[0]?.rows[0]?.id).toBe('appt-hist-c2-11');
    expect(visitsSections(rows, VisitFilter.NoShow, WORDS)).toEqual([]);
    expect(
      rowsOf(visitsSections(rows, VisitFilter.Completed, WORDS)),
    ).toHaveLength(13);
    const ahead = visitsSections(
      visitsRows(georgiInput()),
      VisitFilter.Upcoming,
      WORDS,
    );
    expect(ahead.map((section) => section.key)).toEqual(['upcoming']);
  });

  it('heads the months in the reader’s language', () => {
    const sections = visitsSections(
      visitsRows(georgiInput({ words: EN })),
      VisitFilter.All,
      EN,
    );
    expect(sections.slice(0, 2).map((s) => [s.label, s.detail])).toEqual([
      ['Upcoming', null],
      ['September 2026', '2 visits'],
    ]);
  });
});

describe('HB · the first quiet line', () => {
  it('says the visits and the cadence, the two figures in primary ink', () => {
    const vm = page();
    expect(vm.line).toEqual([
      { text: '24', fact: true },
      { text: `${NB}посещения${J}през${NB}`, fact: false },
      { text: '4', fact: true },
      { text: `${NB}седмици`, fact: false },
    ]);
    expect(text(vm.line)).toBe(held('24 посещения · през 4 седмици'));
    expect(vm.lineName).toBe('Общо: 24 посещения, средно на 4 седмици');
    const martin = page({ rows: martinInput(), stats: MARTIN_STATS });
    expect(text(martin.line)).toBe(held('13 посещения · през 6 седмици'));
    expect(factsIn(martin.line)).toEqual(['13', '6']);
    expect(martin.lineName).toBe('Общо: 13 посещения, средно на 6 седмици');
  });

  it('finds each figure in its own words: the cadence’s «4» is never the end of «24»', () => {
    const vm = page({
      stats: withLifetime(GEORGI_STATS, { visitsCompleted: 4 }),
    });
    expect(text(vm.line)).toBe(held('4 посещения · през 4 седмици'));
    expect(vm.line.map((part) => part.fact)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(factsIn(page().line)).toEqual(['24', '4']);
  });

  it('adds no-shows and the client’s cancellations only when there are some', () => {
    const vm = page({
      stats: withLifetime(GEORGI_STATS, { noShows: 2, clientCancels: 1 }),
    });
    expect(vm.line).toEqual([
      { text: '24', fact: true },
      { text: `${NB}посещения${J}през${NB}`, fact: false },
      { text: '4', fact: true },
      { text: `${NB}седмици${J}`, fact: false },
      { text: '2', fact: true },
      { text: `${NB}неявявания${J}`, fact: false },
      { text: '1', fact: true },
      { text: `${NB}отказ${NB}от${NB}клиента`, fact: false },
    ]);
    expect(vm.lineName).toBe(
      'Общо: 24 посещения, средно на 4 седмици, 2 неявявания, 1 отказ от клиента',
    );
    // Мартин's one cancellation was the shop's (Нико away): never his.
    expect(
      factsIn(page({ rows: martinInput(), stats: MARTIN_STATS }).line),
    ).toEqual(['13', '6']);
  });

  it('has no cadence before there is one, and one visit reads in the singular', () => {
    const vm = page({
      stats: {
        ...withLifetime(GEORGI_STATS, { visitsCompleted: 1 }),
        avgCadenceDays: null,
      },
    });
    expect(vm.line).toEqual([
      { text: '1', fact: true },
      { text: `${NB}посещение`, fact: false },
    ]);
    expect(vm.lineName).toBe('Общо: 1 посещение');
    expect(
      text(page({ stats: { ...GEORGI_STATS, avgCadenceDays: 5 } }).line),
    ).toBe(held('24 посещения · през 1 седмица'));
  });

  it('says «Първо посещение» before the first worked visit, with or without a record', () => {
    for (const stats of [null, NEW_CLIENT]) {
      const vm = page({ stats });
      expect(vm.line).toEqual([{ text: `Първо${NB}посещение`, fact: false }]);
      expect(vm.lineName).toBe('Първо посещение');
      // A zero is not a fact of this person's.
      expect(vm.cells).toEqual([]);
    }
  });

  it('still says what a first-timer’s record holds: the hours they did not come to', () => {
    const vm = page({ stats: withLifetime(NEW_CLIENT, { noShows: 2 }) });
    expect(vm.line).toEqual([
      { text: `Първо${NB}посещение${J}`, fact: false },
      { text: '2', fact: true },
      { text: `${NB}неявявания`, fact: false },
    ]);
    expect(vm.lineName).toBe('Първо посещение, 2 неявявания');
    expect(vm.cells).toEqual([
      { id: 'noShows', value: '2', caption: 'неявявания' },
    ]);
  });

  it('keeps the figures as cells, for the band’s way back (DV-D)', () => {
    expect(page().cells).toEqual([
      { id: 'visits', value: '24', caption: 'посещения' },
      { id: 'cadence', value: '~4', unit: 'седм.', caption: 'интервал' },
    ]);
    expect(
      page({
        stats: withLifetime(GEORGI_STATS, { noShows: 2, clientCancels: 1 }),
      }).cells.map((cell) => cell.id),
    ).toEqual(['visits', 'cadence', 'noShows', 'cancelled']);
  });

  it('reads in English by the same rule', () => {
    const vm = page({
      rows: georgiInput({ words: EN }),
      stats: withLifetime(GEORGI_STATS, { noShows: 1 }),
    });
    expect(text(vm.line)).toBe(held('24 visits · every 4 weeks · 1 no-show'));
    // «no-» never ends a line with «show» opening the next.
    expect(text(vm.line)).toContain(`1${NB}no-${WJ}show`);
    expect(factsIn(vm.line)).toEqual(['24', '4', '1']);
    expect(vm.lineName).toBe(
      'In total: 24 visits, every 4 weeks on average, 1 no-show',
    );
  });
});

describe('HC · the second quiet line', () => {
  it('says a clean record, and to an ‹admin› the sum, its figure in primary ink', () => {
    const vm = page({ spend: SPEND });
    expect(vm.facts).toEqual([
      {
        // The note is a sentence and wraps where it must; the sum's few
        // words never part.
        text: `Без неявявания и откази от клиента${J}похарчени${NB}общо${NB}`,
        fact: false,
      },
      { text: NBSP_EURO('462,50 €'), fact: true },
    ]);
    // A barber reads no money.
    expect(page().facts).toEqual([
      { text: 'Без неявявания и откази от клиента', fact: false },
    ]);
  });

  it('lets the sum stand as its own sentence when the record is not clean', () => {
    const risky = withLifetime(GEORGI_STATS, { noShows: 1 });
    expect(page({ stats: risky, spend: SPEND }).facts).toEqual([
      { text: `Похарчени${NB}общо${NB}`, fact: false },
      { text: NBSP_EURO('462,50 €'), fact: true },
    ]);
    // Nothing to say: the line is absent, never an empty frame.
    expect(page({ stats: risky }).facts).toBeNull();
  });

  it('is absent before the first worked visit: no record to call clean, nothing paid yet', () => {
    expect(page({ stats: null, spend: SPEND }).facts).toBeNull();
    expect(page({ stats: NEW_CLIENT, spend: SPEND }).facts).toBeNull();
    expect(page({ stats: NEW_CLIENT }).facts).toBeNull();
  });

  it('finds the sum where the language puts it', () => {
    const spend = historyFacts(GEORGI_STATS, GEORGI_MONEY, EN).spend;
    const sum = spend?.value ?? '';
    expect(sum).not.toBe('');
    const clean = page({ rows: georgiInput({ words: EN }), spend });
    // The note is a sentence of its own: it wraps where it must, its
    // hyphen as written.
    expect(text(clean.facts)).toBe(
      `No no-shows or client cancellations${J}${held(`${sum} spent in all`)}`,
    );
    expect(factsIn(clean.facts)).toEqual([sum]);
    expect(clean.facts?.at(-1)).toEqual({
      text: held(' spent in all'),
      fact: false,
    });
    const risky = page({
      rows: georgiInput({ words: EN }),
      stats: withLifetime(GEORGI_STATS, { clientCancels: 2 }),
      spend,
    });
    expect(text(risky.facts)).toBe(held(`Spent in total ${sum}`));
    expect(factsIn(risky.facts)).toEqual([sum]);
  });
});

describe('the lines’ runs', () => {
  const pages: readonly VisitsPageVm[] = [
    page({ spend: SPEND }),
    page({
      stats: withLifetime(GEORGI_STATS, { noShows: 2, clientCancels: 1 }),
      spend: SPEND,
    }),
    page({ stats: withLifetime(NEW_CLIENT, { clientCancels: 3 }) }),
    page({ rows: georgiInput({ words: EN }), spend: SPEND }),
    page({
      rows: georgiInput({ words: EN }),
      stats: withLifetime(GEORGI_STATS, { noShows: 1, clientCancels: 12 }),
      spend: historyFacts(GEORGI_STATS, GEORGI_MONEY, EN).spend,
    }),
  ];

  it('never open a wrapped line on the joint: the space before «·» does not break, the one after it does', () => {
    for (const vm of pages) {
      for (const line of [text(vm.line), text(vm.facts)]) {
        expect(line).not.toContain(' ·');
        expect(line).not.toContain(`·${NB}`);
        expect(line.split('·').length).toBe(line.split(J).length);
      }
    }
  });

  it('keep a fact’s words together: a figure with its noun, the sum in its sentence', () => {
    for (const vm of pages) {
      // HB parts at its joints and nowhere else.
      expect(text(vm.line).replaceAll('· ', '')).not.toContain(' ');
      // HC: what follows the note's joint is the sum, whole.
      const facts = text(vm.facts);
      const sum = facts.includes(J)
        ? facts.slice(facts.indexOf(J) + J.length)
        : '';
      expect(sum).not.toContain(' ');
    }
    // The clean record's own sentence wraps where it must.
    expect(text(page().facts)).toBe('Без неявявания и откази от клиента');
    // No stretch between two joints is long enough to overflow a phone.
    for (const vm of pages) {
      for (const stretch of text(vm.line).split('· ')) {
        expect(stretch.length).toBeLessThanOrEqual(26);
      }
    }
  });

  it('change ink at every run, and hold no empty run', () => {
    for (const vm of pages) {
      for (const line of [vm.line, vm.facts ?? []]) {
        expect(line.every((part) => part.text !== '')).toBe(true);
        expect(
          line.every(
            (part, index) => index === 0 || part.fact !== line[index - 1]?.fact,
          ),
        ).toBe(true);
        // A figure is set apart, never its words and never its spaces.
        for (const part of line.filter((it) => it.fact)) {
          expect(part.text).toBe(part.text.trim());
        }
      }
    }
  });
});

describe('the page', () => {
  it('hands the browser the choice, the options the rows answer, the months and the foot', () => {
    const vm = page({ spend: SPEND });
    expect(vm.loadState).toBe(LoadState.Ready);
    expect(vm.filter).toBe(VisitFilter.All);
    // A complete book with nothing but worked visits and one hour ahead.
    expect(vm.offeredFilters).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
    ]);
    expect(vm.sections).toEqual(
      visitsSections(visitsRows(georgiInput()), VisitFilter.All, WORDS),
    );
    expect(vm.paging).toEqual(END);
  });

  it('keeps the terminal options on offer while older pages remain', () => {
    expect(page({ paging: MORE }).offeredFilters).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ]);
    // Offline with a cursor left: no foot, and the list is still not whole.
    const offline = page({
      rows: martinInput(),
      stats: MARTIN_STATS,
      paging: null,
    });
    expect(offline.paging).toBeNull();
    expect(offline.offeredFilters).toEqual([
      VisitFilter.All,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ]);
    // Мартин's whole book: the shop's cancellation answers «Отказани».
    expect(
      page({ rows: martinInput(), stats: MARTIN_STATS }).offeredFilters,
    ).toEqual([VisitFilter.All, VisitFilter.Completed, VisitFilter.Cancelled]);
  });

  it('narrows the list and leaves the lines alone', () => {
    const vm = page({
      rows: martinInput(),
      stats: MARTIN_STATS,
      filter: VisitFilter.Cancelled,
    });
    expect(vm.filter).toBe(VisitFilter.Cancelled);
    expect(rowsOf(vm.sections).map((row) => row.id)).toEqual([
      'appt-hist-c2-11',
    ]);
    expect(text(vm.line)).toBe(held('13 посещения · през 6 седмици'));
    expect(vm.paging).toEqual(END);
  });

  it('ends a list the filter emptied on nothing, and still offers the older pages', () => {
    const whole = page({ filter: VisitFilter.NoShow });
    expect(whole.sections).toEqual([]);
    expect(whole.paging).toEqual({
      pagingState: PagingState.End,
      endLabel: null,
    });
    const partial = page({ filter: VisitFilter.NoShow, paging: MORE });
    expect(partial.sections).toEqual([]);
    expect(partial.paging).toEqual(MORE);
  });

  it('always lists the choice in force, in the menu’s order, so the list can be widened again', () => {
    // Picked while older pages remained; the last page held no no-show.
    expect(page({ filter: VisitFilter.NoShow }).offeredFilters).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.NoShow,
    ]);
    expect(page({ filter: VisitFilter.Cancelled }).offeredFilters).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.Cancelled,
    ]);
  });

  it('draws no row, no foot and no option while the first page is on its way, or failed', () => {
    for (const loadState of [LoadState.Loading, LoadState.Failed] as const) {
      const vm = page({ loadState, spend: SPEND, paging: MORE });
      expect(vm.loadState).toBe(loadState);
      expect(vm.sections).toEqual([]);
      expect(vm.paging).toBeNull();
      expect(vm.offeredFilters).toEqual([VisitFilter.All]);
      // The record is its own read: what it knows is still said.
      expect(text(vm.line)).toBe(held('24 посещения · през 4 седмици'));
      expect(vm.lineName).toBe('Общо: 24 посещения, средно на 4 седмици');
      expect(factsIn(vm.facts)).toEqual([NBSP_EURO('462,50 €')]);
      expect(
        page({ loadState, filter: VisitFilter.Completed }).offeredFilters,
      ).toEqual([VisitFilter.All, VisitFilter.Completed]);
    }
  });

  it('tells nobody «Първо посещение» before a read has answered', () => {
    for (const loadState of [LoadState.Loading, LoadState.Failed] as const) {
      const vm = page({ loadState, stats: null, spend: SPEND });
      expect(vm.line).toEqual([]);
      expect(vm.lineName).toBe('');
      expect(vm.facts).toBeNull();
      expect(vm.cells).toEqual([]);
    }
  });

  it('answers a blank page before the words are there', () => {
    expect(visitsPageBlank(LoadState.Loading, VisitFilter.All)).toEqual({
      loadState: LoadState.Loading,
      line: [],
      lineName: '',
      facts: null,
      cells: [],
      filter: VisitFilter.All,
      offeredFilters: [VisitFilter.All],
      sections: [],
      paging: null,
    });
    expect(
      visitsPageBlank(LoadState.Failed, VisitFilter.NoShow).offeredFilters,
    ).toEqual([VisitFilter.All, VisitFilter.NoShow]);
  });

  it('holds what the contract’s fixtures hold (client-pages.vm.spec)', () => {
    const filters: readonly VisitFilter[] = [
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ];
    const pages = filters.flatMap((filter) => [
      page({ filter }),
      page({ filter, paging: MORE }),
      page({ filter, rows: martinInput(), stats: MARTIN_STATS }),
      page({ filter, loadState: LoadState.Loading }),
      page({ filter, loadState: LoadState.Failed, stats: null }),
    ]);
    for (const vm of pages) {
      expect(vm.offeredFilters).toContain(VisitFilter.All);
      expect(vm.offeredFilters).toContain(vm.filter);
      if (vm.loadState !== LoadState.Ready) expect(vm.paging).toBeNull();
      for (const row of rowsOf(vm.sections)) {
        // The face keeps the trailing edge; the fact is never the barber.
        expect(row.trailing).not.toBeNull();
        expect(row.struck).toBe(
          row.outcome === VisitRowOutcome.NoShow ||
            row.outcome === VisitRowOutcome.Cancelled,
        );
      }
      for (const section of vm.sections) {
        expect(section.testId).toBe(
          section.key === 'upcoming'
            ? 'history-upcoming'
            : `history-month-${section.key}`,
        );
      }
    }
  });
});

describe('HI/HJ · the list’s foot', () => {
  const foot = (overrides: Partial<VisitsPagingInput> = {}) =>
    visitsPaging({
      cursor: sofia('2025-03-06T10:00:00'),
      pagingState: PagingState.More,
      online: true,
      stats: GEORGI_STATS,
      words: WORDS,
      ...overrides,
    });

  it('offers «Покажи още» while older visits remain, its busy and failed states on the way', () => {
    expect(foot()).toEqual({ pagingState: PagingState.More, endLabel: null });
    expect(foot({ pagingState: PagingState.Loading })).toEqual({
      pagingState: PagingState.Loading,
      endLabel: null,
    });
    expect(foot({ pagingState: PagingState.Failed })).toEqual({
      pagingState: PagingState.Failed,
      endLabel: null,
    });
  });

  it('offers nothing offline: a read that cannot answer', () => {
    expect(foot({ online: false })).toBeNull();
    expect(foot({ online: false, pagingState: PagingState.Failed })).toBeNull();
    // The last page is read: the end is a fact, online or not.
    expect(foot({ online: false, cursor: null })).toEqual(END);
  });

  it('ends on the first visit’s day, the year always named', () => {
    expect(foot({ cursor: null })).toEqual({
      pagingState: PagingState.End,
      endLabel: 'Първо посещение: 6.03.2025 г.',
    });
    expect(foot({ cursor: null, words: EN })?.endLabel).toMatch(
      /^First visit: \S*2025$/,
    );
  });

  it('ends on «Това е първото посещение.» before the first worked visit, and on nothing without the day', () => {
    expect(foot({ cursor: null, stats: null })).toEqual({
      pagingState: PagingState.End,
      endLabel: 'Това е първото посещение.',
    });
    expect(foot({ cursor: null, stats: NEW_CLIENT })?.endLabel).toBe(
      'Това е първото посещение.',
    );
    expect(
      foot({ cursor: null, stats: { ...GEORGI_STATS, ...NO_FIRST_VISIT } }),
    ).toEqual({ pagingState: PagingState.End, endLabel: null });
  });
});

describe('the signatures the store composes (§7.3)', () => {
  it('takes the built rows’ input and answers the contract’s view models', () => {
    expectTypeOf(visitsRows).parameters.toEqualTypeOf<[HistoryRowsInput]>();
    expectTypeOf(visitsRows).returns.toEqualTypeOf<readonly VisitRowVm[]>();
    expectTypeOf(visitsSections).parameters.toEqualTypeOf<
      [readonly VisitRowVm[], VisitFilter, ClientCardWords]
    >();
    expectTypeOf(visitsSections).returns.toEqualTypeOf<
      readonly VisitSectionVm[]
    >();
    expectTypeOf(visitsPageVm).parameters.toEqualTypeOf<[VisitsPageInput]>();
    expectTypeOf(visitsPageVm).returns.toEqualTypeOf<VisitsPageVm>();
    expectTypeOf<VisitsPageInput['paging']>().toEqualTypeOf<
      ReturnType<typeof visitsPaging>
    >();
  });
});
