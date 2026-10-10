import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { deepFreeze, unwrapOk } from '../testing';
import {
  type FilterRow,
  type SectionRow,
  type VisitFilter,
  VisitListSystem,
  type VisitRowOutcome,
  type VisitSection,
} from './visit-list.system';
import { DstResolution, ZonedTimeSystem } from './zoned-time.system';

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
 */

const S = VisitListSystem;
const ZONE = 'Europe/Sofia';
const UPCOMING_SECTION_KEY = S.UPCOMING_SECTION_KEY;

type Row = SectionRow & FilterRow;

/** A wall clock in the shop's zone → its instant and its day. */
function at(iso: string): {
  readonly epochMs: number;
  readonly dayKey: DayKey;
} {
  return {
    epochMs: unwrapOk(ZonedTimeSystem.parseIso(iso, ZONE, DstResolution.Reject))
      .epochMs,
    dayKey: DayKey.of(iso.slice(0, 10)),
  };
}

/** A row as the builder files it: only what sectioning reads is real. */
function row(
  id: string,
  iso: string,
  options: {
    readonly upcoming?: boolean;
    readonly grain?: 'month' | 'year';
    readonly outcome?: VisitRowOutcome;
  } = {},
): Row {
  const start = at(iso);
  const upcoming = options.upcoming ?? false;
  return {
    id,
    startMs: start.epochMs,
    sectionKey: upcoming
      ? UPCOMING_SECTION_KEY
      : S.sectionKeyOf(start.dayKey, options.grain ?? 'month'),
    upcoming,
    outcome: options.outcome ?? (upcoming ? 'open' : 'worked'),
  };
}

/** The legacy call: sections, with the figure each dated heading would carry. */
function sectionVisits(
  rows: readonly Row[],
  options: {
    readonly grain: 'month' | 'year';
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
      : `${prefix}-${options.grain}-${section.key}`,
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
      { grain: 'month' },
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
      { grain: 'month' },
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
        row('sep-2026', '2026-09-04T10:00:00', { grain: 'year' }),
        row('jul-2026', '2026-07-16T10:00:00', { outcome: 'cancelled' }),
        row('mar-2025', '2025-03-06T10:00:00', { grain: 'year' }),
        row('this-visit', '2026-10-02T10:00:00', { upcoming: true }),
      ],
      {
        grain: 'year',
        // The staff heading's figure: worked visits only, absent at zero.
        detail: (rows) => {
          const worked = rows.filter((entry) => entry.outcome === 'worked');
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
        grain: 'year',
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
      { grain: 'month' },
    );
    expect(sections.map((section) => section.key)).toEqual([
      '2026-09',
      '2026-06',
    ]);
    // No upcoming row, no upcoming heading.
    expect(sections.some((section) => section.key === 'upcoming')).toBe(false);
    expect(sectionVisits([], { grain: 'month' })).toEqual([]);
  });

  it('keeps one order whatever order the rows arrive in', () => {
    const rows = [
      row('b', '2026-09-04T10:00:00'),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2026-09-01T10:00:00'),
    ];
    const forward = sectionVisits(rows, { grain: 'month' });
    const backward = sectionVisits([...rows].reverse(), { grain: 'month' });
    expect(ids(forward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
    expect(ids(backward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('names its test ids after the family the host asks for, `visits` by default', () => {
    const sections = sectionVisits(
      [
        row('ahead', '2026-10-02T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      { grain: 'month' },
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
      { grain: 'month', detail: workedVisitsDetail() },
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
        row('missed', '2026-07-07T10:00:00', { outcome: 'no_show' }),
        row('called-off', '2026-07-16T10:00:00', { outcome: 'cancelled' }),
      ]),
    ).toBeNull();
    expect(
      detail([
        row('worked-a', '2026-07-20T10:00:00'),
        row('worked-b', '2026-07-02T10:00:00'),
        row('missed', '2026-07-07T10:00:00', { outcome: 'no_show' }),
      ]),
    ).toBe(2);
    expect(detail([])).toBeNull();
  });

  it('takes the floor its grain asks for: a year’s figure is a fact from the first visit on', () => {
    const byYear = workedVisitsDetail(1);
    expect(
      byYear([row('only', '2025-03-06T10:00:00', { grain: 'year' })]),
    ).toBe(1);
    // Nothing worked is never «0 посещения», whatever the floor.
    expect(
      workedVisitsDetail(0)([
        row('missed', '2025-03-06T10:00:00', { outcome: 'no_show' }),
      ]),
    ).toBeNull();
  });
});

describe('visitSectionKey', () => {
  it('files a visit on its own calendar, never the device’s', () => {
    // 00:30 on 1 October in Sofia is still 30 September in UTC: the day the
    // shop's table names is the 1st.
    const justAfterMidnight = at('2026-10-01T00:30:00');
    const days = ZonedTimeSystem.dayTableAround(
      ZONE,
      justAfterMidnight.epochMs,
      justAfterMidnight.epochMs,
      1,
    );
    const day = ZonedTimeSystem.dayKeyOf(justAfterMidnight.epochMs, days);
    if (day === null) throw new Error('fixture');
    expect(S.sectionKeyOf(day, 'month')).toBe('2026-10');
    expect(S.sectionKeyOf(day, 'year')).toBe('2026');
    const newYear = at('2027-01-01T00:15:00');
    const newYearDays = ZonedTimeSystem.dayTableAround(
      ZONE,
      newYear.epochMs,
      newYear.epochMs,
      1,
    );
    const newYearDay = ZonedTimeSystem.dayKeyOf(newYear.epochMs, newYearDays);
    if (newYearDay === null) throw new Error('fixture');
    expect(S.sectionKeyOf(newYearDay, 'year')).toBe('2027');
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
  filterRow('ahead', true, 'open'),
  filterRow('waiting', true, null),
  filterRow('worked', false, 'worked'),
  filterRow('no-show', false, 'no_show'),
  filterRow('cancelled', false, 'cancelled'),
  // A past hour nobody settled: none of the three outcomes, not ahead.
  filterRow('unsettled', false, 'open'),
];

const matchesVisitFilter = S.matches;
const visitFiltersFor = S.filtersFor;
const offeredVisitFilters = (
  perspective: 'client' | 'staff',
  rows: readonly FilterRow[],
  options: { readonly complete: boolean },
) => S.offered(perspective, rows, options.complete);

const kept = (filter: VisitFilter) =>
  ROWS.filter((entry) => matchesVisitFilter(entry, filter)).map(
    (entry) => entry.id,
  );

describe('matchesVisitFilter', () => {
  it('keeps every row unfiltered', () => {
    expect(kept('all')).toEqual(ROWS.map((entry) => entry.id));
  });

  it('keeps the run ahead under «Предстоящи», a waiting request included', () => {
    expect(kept('upcoming')).toEqual(['ahead', 'waiting']);
  });

  it('narrows the past to the one outcome each terminal filter names', () => {
    expect(kept('completed')).toEqual(['worked']);
    expect(kept('no_show')).toEqual(['no-show']);
    expect(kept('cancelled')).toEqual(['cancelled']);
  });

  it('reads the row’s OWN outcome — the subject’s on the staff card', () => {
    // A companion no-showed on a visit the subject was worked on: the
    // subject's row is `worked`, and «Неявявания» must not list it.
    const party = filterRow('party', false, 'worked');
    expect(matchesVisitFilter(party, 'no_show')).toBe(false);
    expect(matchesVisitFilter(party, 'completed')).toBe(true);
  });
});

describe('visitFiltersFor', () => {
  it('offers the client’s options in the order their list always read', () => {
    expect(visitFiltersFor('client')).toEqual([
      'all',
      'upcoming',
      'completed',
      'cancelled',
      'no_show',
    ]);
  });

  it('offers the staff history’s options as its spec lists them', () => {
    expect(visitFiltersFor('staff')).toEqual([
      'all',
      'upcoming',
      'completed',
      'no_show',
      'cancelled',
    ]);
  });
});

describe('offeredVisitFilters', () => {
  const past = ROWS.filter((entry) => !entry.upcoming);
  const workedOnly = [filterRow('worked', false, 'worked')];

  it('offers every option a row answers, in the menu’s order', () => {
    expect(offeredVisitFilters('staff', ROWS, { complete: true })).toEqual(
      visitFiltersFor('staff'),
    );
    expect(offeredVisitFilters('client', ROWS, { complete: true })).toEqual(
      visitFiltersFor('client'),
    );
  });

  it('leaves out what no row answers once the book is read to its end — «Всички» always stays', () => {
    const withNoShow = [...workedOnly, filterRow('missed', false, 'no_show')];
    expect(
      offeredVisitFilters('staff', withNoShow, { complete: true }),
    ).toEqual(['all', 'completed', 'no_show']);
    expect(offeredVisitFilters('staff', [], { complete: true })).toEqual([
      'all',
    ]);
  });

  it('leaves out what every row answers once the book is read to its end: a choice that narrows nothing', () => {
    // Every visit worked and none is ahead: «Минали» would show the same
    // rows, so only «Всички» is left and the host shows no funnel.
    const worked = [
      ...workedOnly,
      filterRow('worked-2', false, 'worked'),
      filterRow('worked-3', false, 'worked'),
    ];
    expect(offeredVisitFilters('staff', worked, { complete: true })).toEqual([
      'all',
    ]);
    expect(offeredVisitFilters('client', worked, { complete: true })).toEqual([
      'all',
    ]);
    // Nothing but what is ahead: «Предстоящи» narrows nothing either.
    const ahead = [
      filterRow('next', true, 'open'),
      filterRow('waiting', true, null),
    ];
    expect(offeredVisitFilters('staff', ahead, { complete: true })).toEqual([
      'all',
    ]);
    // One hour ahead is enough for both to narrow.
    expect(
      offeredVisitFilters(
        'staff',
        [...worked, filterRow('next', true, 'open')],
        { complete: true },
      ),
    ).toEqual(['all', 'upcoming', 'completed']);
    // While older pages remain, an older page is a past hour, so a list of
    // upcoming rows alone still narrows under «Предстоящи».
    expect(offeredVisitFilters('staff', ahead, { complete: false })).toEqual([
      'all',
      'upcoming',
      'completed',
      'no_show',
      'cancelled',
    ]);
  });

  it('keeps the past outcomes while older pages remain, but «Предстоящи» is the first read’s to answer', () => {
    expect(
      offeredVisitFilters('staff', workedOnly, { complete: false }),
    ).toEqual(['all', 'completed', 'no_show', 'cancelled']);
    expect(
      offeredVisitFilters('staff', past, { complete: false }),
    ).not.toContain('upcoming');
  });
});

describe('VisitListSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rows = deepFreeze([
      row('b', '2026-09-04T10:00:00'),
      row('next', '2026-10-05T10:00:00', { upcoming: true }),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2025-09-01T10:00:00', { outcome: 'no_show' }),
    ]);
    const once = S.sections(rows, 'month');
    expect(S.sections(rows, 'month')).toEqual(once);
    expect(S.sections(rows, 'year')).toEqual(S.sections(rows, 'year'));
    expect(ids(rows)).toEqual(['b', 'next', 'a', 'c']);
    expect(S.offered('staff', rows, true)).toEqual(
      S.offered('staff', rows, true),
    );
  });
});
