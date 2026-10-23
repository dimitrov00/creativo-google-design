import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  type LocalDate,
  type MinuteOfDay,
} from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  minute,
  utcMs,
} from '@core/testing';
import {
  type FilterRow,
  type SectionRow,
  type VisitFilter,
  VisitListSystem,
  type VisitRowOutcome,
  type VisitSection,
} from './visit-list.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * COPIED and re-targeted:
 * - libs/features/shared/visits/src/lib/visit-sections.spec.ts — the seven
 *   `sectionVisits` cases, the three `workedVisitsDetail` cases and the one
 *   `visitSectionKey` case (11 of 13). The system answers keys and rows, so
 *   a case's label assertion reads the section key the template words, its
 *   test-id assertion the grain and key the host names the id after, and
 *   `detail` reads the worked figure the word is built on. The two
 *   `visitSectionLabel` cases are `Intl` wording (the template layer's) and
 *   are not copied.
 * - libs/features/shared/visits/src/lib/visit-filter.spec.ts — the ten
 *   `matchesVisitFilter` / `visitFiltersFor` / `offeredVisitFilters` cases
 *   (10 of 12); the two `visitFilterWordKey` cases are catalogue keys.
 * Plus purity.
 *
 * Flatten pass (Law 7, T1): a row starts at a shop day and minute
 * (`localDate` + `startMinutes`), not an instant, and every tag is SCREAMING
 * (`'month'` → `'MONTH'`, `'no_show'` → `'NO_SHOW'`); the host words its test
 * ids after the grain in lower case, as the legacy ids read.
 */

const S = VisitListSystem;
const UPCOMING_SECTION_KEY = S.UPCOMING_SECTION_KEY;

type Row = SectionRow & FilterRow;

/** A wall clock on the shop's calendar → its day and its minute. */
function at(iso: string): {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
} {
  return {
    localDate: localDate(iso.slice(0, 10)),
    startMinutes: minute(
      Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)),
    ),
  };
}

/** A row as the builder files it: only what sectioning reads is real. */
function row(
  id: string,
  iso: string,
  options: {
    readonly upcoming?: boolean;
    readonly grain?: 'MONTH' | 'YEAR';
    readonly outcome?: VisitRowOutcome;
  } = {},
): Row {
  const start = at(iso);
  const upcoming = options.upcoming ?? false;
  return {
    id,
    localDate: start.localDate,
    startMinutes: start.startMinutes,
    sectionKey: upcoming
      ? UPCOMING_SECTION_KEY
      : S.sectionKeyOf(start.localDate, options.grain ?? 'MONTH'),
    upcoming,
    outcome: options.outcome ?? (upcoming ? 'OPEN' : 'WORKED'),
  };
}

/** The legacy call: sections, with the figure each dated heading would carry. */
function sectionVisits(
  rows: readonly Row[],
  options: {
    readonly grain: 'MONTH' | 'YEAR';
    readonly detail?: (rows: readonly Row[]) => number | null;
    readonly testIdPrefix?: string;
  },
): readonly (VisitSection<Row> & {
  readonly detail: number | null;
  readonly testId: string;
})[] {
  const prefix = options.testIdPrefix ?? 'visits';
  return S.sections(rows, options.grain).map((section) => ({
    ...section,
    detail: section.upcoming ? null : (options.detail?.(section.rows) ?? null),
    testId: section.upcoming
      ? `${prefix}-${UPCOMING_SECTION_KEY}`
      : `${prefix}-${options.grain.toLowerCase()}-${section.key}`,
  }));
}

/** A heading's figure, as the staff history counts it (from `atLeast` up). */
const workedVisitsDetail =
  (atLeast = 2) =>
  (rows: readonly Row[]): number | null =>
    S.workedFigure(rows, atLeast);

const ids = (rows: readonly Row[]) => rows.map((entry) => entry.id);

describe('sectionVisits', () => {
  it('leads with the upcoming run, soonest first, then the months newest first, each newest first', () => {
    const sections = sectionVisits(
      [
        row('aug-early', '2026-08-03T10:00:00'),
        row('next-week', '2026-10-05T10:00:00', { upcoming: true }),
        row('sep-late', '2026-09-24T10:00:00'),
        row('tomorrow', '2026-09-29T10:00:00', { upcoming: true }),
        row('aug-late', '2026-08-27T10:00:00'),
        row('sep-early', '2026-09-04T10:00:00'),
      ],
      { grain: 'MONTH' },
    );

    expect(sections.map((section) => section.key)).toEqual([
      'upcoming',
      '2026-09',
      '2026-08',
    ]);
    // The headings the template words («Предстоящи», «Септември 2026 г.»,
    // «Август 2026 г.») are read off these: the upcoming run, then the keys.
    expect(sections.map((section) => section.upcoming)).toEqual([
      true,
      false,
      false,
    ]);
    expect(sections.map((section) => ids(section.rows))).toEqual([
      ['tomorrow', 'next-week'],
      ['sep-late', 'sep-early'],
      ['aug-late', 'aug-early'],
    ]);
    // A list that asks for no figure gets none, anywhere.
    expect(sections.every((section) => section.detail === null)).toBe(true);
  });

  it('never draws two «Юли» a year apart under the same word — the label carries its year', () => {
    const sections = sectionVisits(
      [
        row('july-2026', '2026-07-16T10:00:00'),
        row('july-2025', '2025-07-07T10:00:00'),
      ],
      { grain: 'MONTH' },
    );
    // Two keys, each with its year — so two headings.
    expect(sections.map((section) => section.key)).toEqual([
      '2026-07',
      '2025-07',
    ]);
  });

  it('sections a barber-cadence history by year, folding month keys into their year', () => {
    const sections = sectionVisits(
      [
        // Built for the year grain, and for the month grain: both file by year.
        row('sep-2026', '2026-09-04T10:00:00', { grain: 'YEAR' }),
        row('jul-2026', '2026-07-16T10:00:00', { outcome: 'CANCELLED' }),
        row('mar-2025', '2025-03-06T10:00:00', { grain: 'YEAR' }),
        row('this-visit', '2026-10-02T10:00:00', { upcoming: true }),
      ],
      {
        grain: 'YEAR',
        // The staff heading's figure: worked visits only, absent at zero.
        detail: (rows) => {
          const worked = rows.filter((entry) => entry.outcome === 'WORKED');
          return worked.length === 0 ? null : worked.length;
        },
        testIdPrefix: 'history',
      },
    );

    expect(
      sections.map(({ key, upcoming, detail, testId }) => ({
        key,
        upcoming,
        detail,
        testId,
      })),
    ).toEqual([
      {
        key: 'upcoming',
        upcoming: true,
        detail: null,
        testId: 'history-upcoming',
      },
      {
        key: '2026',
        upcoming: false,
        detail: 1,
        testId: 'history-year-2026',
      },
      {
        key: '2025',
        upcoming: false,
        detail: 1,
        testId: 'history-year-2025',
      },
    ]);
    expect(ids(sections[1]?.rows ?? [])).toEqual(['sep-2026', 'jul-2026']);
  });

  it('asks for the figure of dated sections only — the upcoming run is a promise, not a record', () => {
    const asked: string[] = [];
    sectionVisits(
      [
        row('ahead', '2026-10-02T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      {
        grain: 'YEAR',
        detail: (rows) => {
          asked.push(...ids(rows));
          return null;
        },
      },
    );
    expect(asked).toEqual(['past']);
  });

  it('gives a period with no visit no section at all, and an empty list none', () => {
    const sections = sectionVisits(
      [row('sep', '2026-09-04T10:00:00'), row('jun', '2026-06-11T10:00:00')],
      { grain: 'MONTH' },
    );
    expect(sections.map((section) => section.key)).toEqual([
      '2026-09',
      '2026-06',
    ]);
    // No upcoming row, no upcoming heading.
    expect(sections.some((section) => section.key === 'upcoming')).toBe(false);
    expect(sectionVisits([], { grain: 'MONTH' })).toEqual([]);
  });

  it('keeps one order whatever order the rows arrive in', () => {
    const rows = [
      row('b', '2026-09-04T10:00:00'),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2026-09-01T10:00:00'),
    ];
    const forward = sectionVisits(rows, { grain: 'MONTH' });
    const backward = sectionVisits([...rows].reverse(), { grain: 'MONTH' });
    expect(ids(forward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
    expect(ids(backward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('names its test ids after the family the host asks for, `visits` by default', () => {
    const sections = sectionVisits(
      [
        row('ahead', '2026-10-02T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      { grain: 'MONTH' },
    );
    expect(sections.map((section) => section.testId)).toEqual([
      'visits-upcoming',
      'visits-month-2026-09',
    ]);
  });
});

describe('workedVisitsDetail', () => {
  it('counts a month’s worked visits from two up, and leaves a one-row month its heading alone', () => {
    const sections = sectionVisits(
      [
        row('next', '2026-10-05T10:00:00', { upcoming: true }),
        row('sep-a', '2026-09-24T10:00:00'),
        row('sep-b', '2026-09-04T10:00:00'),
        row('sep-c', '2026-09-02T10:00:00'),
        row('aug', '2026-08-03T10:00:00'),
      ],
      { grain: 'MONTH', detail: workedVisitsDetail() },
    );
    expect(sections.map((section) => [section.key, section.detail])).toEqual([
      // The upcoming run is a promise, not a record: never asked.
      [UPCOMING_SECTION_KEY, null],
      ['2026-09', 3],
      // «1 посещение» over one row says what the row already does.
      ['2026-08', null],
    ]);
  });

  it('counts what was WORKED: a cancellation and a no-show are rows, not visits', () => {
    const detail = workedVisitsDetail();
    expect(
      detail([
        row('worked', '2026-07-20T10:00:00'),
        row('missed', '2026-07-07T10:00:00', { outcome: 'NO_SHOW' }),
        row('called-off', '2026-07-16T10:00:00', { outcome: 'CANCELLED' }),
      ]),
    ).toBeNull();
    expect(
      detail([
        row('worked-a', '2026-07-20T10:00:00'),
        row('worked-b', '2026-07-02T10:00:00'),
        row('missed', '2026-07-07T10:00:00', { outcome: 'NO_SHOW' }),
      ]),
    ).toBe(2);
    expect(detail([])).toBeNull();
  });

  it('takes the floor its grain asks for: a year’s figure is a fact from the first visit on', () => {
    const byYear = workedVisitsDetail(1);
    expect(
      byYear([row('only', '2025-03-06T10:00:00', { grain: 'YEAR' })]),
    ).toBe(1);
    // Nothing worked is never «0 посещения», whatever the floor.
    expect(
      workedVisitsDetail(0)([
        row('missed', '2025-03-06T10:00:00', { outcome: 'NO_SHOW' }),
      ]),
    ).toBeNull();
  });
});

describe('visitSectionKey', () => {
  it('files a visit on its own calendar, never the device’s', () => {
    // 00:30 on 1 October in Sofia is still 30 September in UTC: the shop
    // day the boundary reads off the instant (`toLocal`) is the 1st.
    const justAfterMidnight = utcMs('2026-10-01T00:30:00.000+03:00');
    const day = ZonedTimeSystem.toLocal(
      justAfterMidnight,
      FIXTURE_TIME_ZONE,
    ).localDate;
    expect(S.sectionKeyOf(day, 'MONTH')).toBe('2026-10');
    expect(S.sectionKeyOf(day, 'YEAR')).toBe('2026');
    const newYear = utcMs('2027-01-01T00:15:00.000+02:00');
    const newYearDay = ZonedTimeSystem.toLocal(
      newYear,
      FIXTURE_TIME_ZONE,
    ).localDate;
    expect(S.sectionKeyOf(newYearDay, 'YEAR')).toBe('2027');
  });
});

/* ── visit-filter.spec.ts ─────────────────────────────────────────────── */

/** A row as the funnel reads it: whether it is ahead, and how it went. */
function filterRow(
  id: string,
  upcoming: boolean,
  outcome: VisitRowOutcome | null,
): FilterRow & { readonly id: string } {
  return { id, upcoming, outcome };
}

const ROWS = [
  filterRow('ahead', true, 'OPEN'),
  filterRow('waiting', true, null),
  filterRow('worked', false, 'WORKED'),
  filterRow('no-show', false, 'NO_SHOW'),
  filterRow('cancelled', false, 'CANCELLED'),
  // A past hour nobody settled: none of the three outcomes, not ahead.
  filterRow('unsettled', false, 'OPEN'),
];

const matchesVisitFilter = S.matches;
const visitFiltersFor = S.filtersFor;
const offeredVisitFilters = (
  perspective: 'CLIENT' | 'STAFF',
  rows: readonly FilterRow[],
  options: { readonly complete: boolean },
) => S.offered(perspective, rows, options.complete);

const kept = (filter: VisitFilter) =>
  ROWS.filter((entry) => matchesVisitFilter(entry, filter)).map(
    (entry) => entry.id,
  );

describe('matchesVisitFilter', () => {
  it('keeps every row unfiltered', () => {
    expect(kept('ALL')).toEqual(ROWS.map((entry) => entry.id));
  });

  it('keeps the run ahead under «Предстоящи», a waiting request included', () => {
    expect(kept('UPCOMING')).toEqual(['ahead', 'waiting']);
  });

  it('narrows the past to the one outcome each terminal filter names', () => {
    expect(kept('COMPLETED')).toEqual(['worked']);
    expect(kept('NO_SHOW')).toEqual(['no-show']);
    expect(kept('CANCELLED')).toEqual(['cancelled']);
  });

  it('reads the row’s OWN outcome — the subject’s on the staff card', () => {
    // A companion no-showed on a visit the subject was worked on: the
    // subject's row is `worked`, and «Неявявания» must not list it.
    const party = filterRow('party', false, 'WORKED');
    expect(matchesVisitFilter(party, 'NO_SHOW')).toBe(false);
    expect(matchesVisitFilter(party, 'COMPLETED')).toBe(true);
  });
});

describe('visitFiltersFor', () => {
  it('offers the client’s options in the order their list always read', () => {
    expect(visitFiltersFor('CLIENT')).toEqual([
      'ALL',
      'UPCOMING',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ]);
  });

  it('offers the staff history’s options as its spec lists them', () => {
    expect(visitFiltersFor('STAFF')).toEqual([
      'ALL',
      'UPCOMING',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ]);
  });
});

describe('offeredVisitFilters', () => {
  const past = ROWS.filter((entry) => !entry.upcoming);
  const workedOnly = [filterRow('worked', false, 'WORKED')];

  it('offers every option a row answers, in the menu’s order', () => {
    expect(offeredVisitFilters('STAFF', ROWS, { complete: true })).toEqual(
      visitFiltersFor('STAFF'),
    );
    expect(offeredVisitFilters('CLIENT', ROWS, { complete: true })).toEqual(
      visitFiltersFor('CLIENT'),
    );
  });

  it('leaves out what no row answers once the book is read to its end — «Всички» always stays', () => {
    const withNoShow = [...workedOnly, filterRow('missed', false, 'NO_SHOW')];
    expect(
      offeredVisitFilters('STAFF', withNoShow, { complete: true }),
    ).toEqual(['ALL', 'COMPLETED', 'NO_SHOW']);
    expect(offeredVisitFilters('STAFF', [], { complete: true })).toEqual([
      'ALL',
    ]);
  });

  it('leaves out what every row answers once the book is read to its end: a choice that narrows nothing', () => {
    // Every visit worked and none is ahead: «Минали» would show the same
    // rows, so only «Всички» is left and the host shows no funnel.
    const worked = [
      ...workedOnly,
      filterRow('worked-2', false, 'WORKED'),
      filterRow('worked-3', false, 'WORKED'),
    ];
    expect(offeredVisitFilters('STAFF', worked, { complete: true })).toEqual([
      'ALL',
    ]);
    expect(offeredVisitFilters('CLIENT', worked, { complete: true })).toEqual([
      'ALL',
    ]);
    // Nothing but what is ahead: «Предстоящи» narrows nothing either.
    const ahead = [
      filterRow('next', true, 'OPEN'),
      filterRow('waiting', true, null),
    ];
    expect(offeredVisitFilters('STAFF', ahead, { complete: true })).toEqual([
      'ALL',
    ]);
    // One hour ahead is enough for both to narrow.
    expect(
      offeredVisitFilters(
        'STAFF',
        [...worked, filterRow('next', true, 'OPEN')],
        { complete: true },
      ),
    ).toEqual(['ALL', 'UPCOMING', 'COMPLETED']);
    // While older pages remain, an older page is a past hour, so a list of
    // upcoming rows alone still narrows under «Предстоящи».
    expect(offeredVisitFilters('STAFF', ahead, { complete: false })).toEqual([
      'ALL',
      'UPCOMING',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ]);
  });

  it('keeps the past outcomes while older pages remain, but «Предстоящи» is the first read’s to answer', () => {
    expect(
      offeredVisitFilters('STAFF', workedOnly, { complete: false }),
    ).toEqual(['ALL', 'COMPLETED', 'NO_SHOW', 'CANCELLED']);
    expect(
      offeredVisitFilters('STAFF', past, { complete: false }),
    ).not.toContain('UPCOMING');
  });
});

describe('VisitListSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rows = deepFreeze([
      row('b', '2026-09-04T10:00:00'),
      row('next', '2026-10-05T10:00:00', { upcoming: true }),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2025-09-01T10:00:00', { outcome: 'NO_SHOW' }),
    ]);
    const once = S.sections(rows, 'MONTH');
    expect(S.sections(rows, 'MONTH')).toEqual(once);
    expect(S.sections(rows, 'YEAR')).toEqual(S.sections(rows, 'YEAR'));
    expect(ids(rows)).toEqual(['b', 'next', 'a', 'c']);
    expect(S.offered('STAFF', rows, true)).toEqual(
      S.offered('STAFF', rows, true),
    );
  });
});

/*
 * Law 10.2 decision extraction (W0-A): the list rules the presenters held —
 * `visit-row.presenter.ts` (the section a row files under),
 * `history.presenter.ts` / `visits-page.presenter.ts` (each visit once; the
 * choice in force always offered) and `glance.presenter.ts` (the next card:
 * soonest first among the visits to come). Each case re-states the pinning
 * presenter case as a key/row/tag assertion.
 */

describe('VisitListSystem.rowSectionKey — where a visit row files', () => {
  it('files an hour still to come under the upcoming run, whatever its date (row 412, visit-sections 81)', () => {
    expect(S.rowSectionKey(true, localDate('2026-10-02'), 'MONTH')).toBe(
      UPCOMING_SECTION_KEY,
    );
    expect(S.rowSectionKey(true, localDate('2026-10-02'), 'YEAR')).toBe(
      'upcoming',
    );
  });

  it('files every other row under its dated section, by the grain (row 235, 447)', () => {
    expect(S.rowSectionKey(false, localDate('2026-09-04'), 'YEAR')).toBe(
      '2026',
    );
    expect(S.rowSectionKey(false, localDate('2026-09-04'), 'MONTH')).toBe(
      '2026-09',
    );
    // The same answer as the dated key itself.
    expect(S.rowSectionKey(false, localDate('2025-12-31'), 'MONTH')).toBe(
      S.sectionKeyOf(localDate('2025-12-31'), 'MONTH'),
    );
  });
});

describe('VisitListSystem.distinctById — each visit once', () => {
  const visit = (id: string, page: number) => ({
    id: AppointmentId.of(id),
    page,
  });

  it('keeps the first copy of an id and the input order (history 73, visits-page 242)', () => {
    const appointments = [
      visit('appt-b', 1),
      visit('appt-a', 1),
      visit('appt-b', 2),
      visit('appt-c', 2),
      visit('appt-a', 3),
    ];
    expect(S.distinctById(appointments)).toEqual([
      visit('appt-b', 1),
      visit('appt-a', 1),
      visit('appt-c', 2),
    ]);
  });

  it('answers nothing for nothing, and every visit when none repeats', () => {
    expect(S.distinctById([])).toEqual([]);
    const once = [visit('appt-a', 1), visit('appt-b', 1)];
    expect(S.distinctById(once)).toEqual(once);
  });
});

describe('VisitListSystem.offeredWith — the choice in force is always offered', () => {
  it('lists the choice in force in the menu’s order, so the list can be widened again (visits-page 707)', () => {
    // Picked while older pages remained; the last page held no no-show.
    expect(
      S.offeredWith('STAFF', ['ALL', 'UPCOMING', 'COMPLETED'], 'NO_SHOW'),
    ).toEqual(['ALL', 'UPCOMING', 'COMPLETED', 'NO_SHOW']);
    expect(
      S.offeredWith('STAFF', ['ALL', 'UPCOMING', 'COMPLETED'], 'CANCELLED'),
    ).toEqual(['ALL', 'UPCOMING', 'COMPLETED', 'CANCELLED']);
    // The staff menu puts no-shows before cancellations; the client's after.
    expect(S.offeredWith('STAFF', ['ALL', 'CANCELLED'], 'NO_SHOW')).toEqual([
      'ALL',
      'NO_SHOW',
      'CANCELLED',
    ]);
    expect(S.offeredWith('CLIENT', ['ALL', 'CANCELLED'], 'NO_SHOW')).toEqual([
      'ALL',
      'CANCELLED',
      'NO_SHOW',
    ]);
  });

  it('adds only the way back while the first page is on its way (visits-page 723, 750)', () => {
    expect(S.offeredWith('STAFF', ['ALL'], 'COMPLETED')).toEqual([
      'ALL',
      'COMPLETED',
    ]);
    expect(S.offeredWith('STAFF', ['ALL'], 'NO_SHOW')).toEqual([
      'ALL',
      'NO_SHOW',
    ]);
    expect(S.offeredWith('STAFF', ['ALL'], 'ALL')).toEqual(['ALL']);
  });

  it('answers the offered list itself when it already holds the choice (visits-page 695)', () => {
    const offered: readonly VisitFilter[] = ['ALL', 'COMPLETED', 'NO_SHOW'];
    expect(S.offeredWith('STAFF', offered, 'NO_SHOW')).toBe(offered);
    expect(S.offeredWith('STAFF', offered, 'ALL')).toBe(offered);
  });
});

describe('VisitListSystem.upcomingSoonestFirst — the next card', () => {
  type Item = { readonly key: string; readonly row: Row };
  const item = (
    key: string,
    iso: string,
    upcoming: boolean,
    id: string = key,
  ): Item => ({ key, row: row(id, iso, { upcoming }) });
  const rowOf = (entry: Item): SectionRow => entry.row;
  const keys = (items: readonly Item[]) => items.map((entry) => entry.key);

  it('keeps the visits to come, SOONEST first whatever order the page holds them in (glance 909)', () => {
    const items = [
      item('later', '2026-10-20T10:00:00', true),
      item('worked', '2026-09-04T10:00:00', false),
      item('soonest', '2026-10-02T09:30:00', true),
      item('same-day-later', '2026-10-02T14:00:00', true),
    ];
    expect(keys(S.upcomingSoonestFirst(items, rowOf))).toEqual([
      'soonest',
      'same-day-later',
      'later',
    ]);
  });

  it('drops every row that is not upcoming (glance 814, 871)', () => {
    const items = [
      item('worked', '2026-09-04T10:00:00', false),
      item('missed', '2026-09-10T10:00:00', false),
    ];
    expect(S.upcomingSoonestFirst(items, rowOf)).toEqual([]);
    expect(S.upcomingSoonestFirst([], rowOf)).toEqual([]);
  });

  it('keeps the INPUT order on an equal day and minute — no id breaks the tie (DEP-2 withdrawn)', () => {
    // The ids would sort «a» first; the input says «z» first, and it stays.
    const items = [
      item('first-in', '2026-10-02T10:00:00', true, 'z'),
      item('second-in', '2026-10-02T10:00:00', true, 'a'),
    ];
    expect(keys(S.upcomingSoonestFirst(items, rowOf))).toEqual([
      'first-in',
      'second-in',
    ]);
    // Reversed input, reversed tie: the order is the caller's.
    expect(keys(S.upcomingSoonestFirst([...items].reverse(), rowOf))).toEqual([
      'second-in',
      'first-in',
    ]);
    // The list's own upcoming run breaks the same tie by id.
    const [run] = S.sections(
      items.map((entry) => entry.row),
      'MONTH',
    );
    expect(run?.rows.map((entry) => entry.id)).toEqual(['a', 'z']);
  });

  it('reads each row once', () => {
    const items = [
      item('a', '2026-10-03T10:00:00', true),
      item('b', '2026-10-02T10:00:00', true),
      item('c', '2026-09-02T10:00:00', false),
    ];
    const read: string[] = [];
    S.upcomingSoonestFirst(items, (entry) => {
      read.push(entry.key);
      return entry.row;
    });
    expect(read).toEqual(['a', 'b', 'c']);
  });
});

describe('VisitListSystem — the extraction, purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rows = deepFreeze([
      row('b', '2026-10-04T10:00:00', { upcoming: true }),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2026-10-02T10:00:00', { upcoming: true }),
    ]);
    const identity = (entry: Row): SectionRow => entry;
    const once = S.upcomingSoonestFirst(rows, identity);
    expect(S.upcomingSoonestFirst(rows, identity)).toEqual(once);
    expect(ids(once)).toEqual(['c', 'b']);
    expect(ids(rows)).toEqual(['b', 'a', 'c']);

    const appointments = deepFreeze([
      { id: AppointmentId.of('x') },
      { id: AppointmentId.of('x') },
    ]);
    expect(S.distinctById(appointments)).toEqual(S.distinctById(appointments));
    expect(appointments).toHaveLength(2);

    const offered = deepFreeze<readonly VisitFilter[]>(['ALL', 'COMPLETED']);
    expect(S.offeredWith('STAFF', offered, 'NO_SHOW')).toEqual(
      S.offeredWith('STAFF', offered, 'NO_SHOW'),
    );
    expect(offered).toEqual(['ALL', 'COMPLETED']);
    expect(S.rowSectionKey(false, localDate('2026-09-04'), 'YEAR')).toBe(
      S.rowSectionKey(false, localDate('2026-09-04'), 'YEAR'),
    );
  });
});
