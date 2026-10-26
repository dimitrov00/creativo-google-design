import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BookingStatus,
  type LocalDate,
  LocationId,
  type MinuteOfDay,
  TimeZone,
} from '@core/primitives';
import {
  type ShopNow,
  type VisitFilter,
  type VisitRowOutcome,
  WallTime,
} from '@core/components';
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
  VisitListSystem,
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

/*
 * OR-56 (b) and (c): what a row's date tile names beside its section's
 * heading, and whether the list's jump rail is drawn at all.
 */

describe('VisitListSystem.tileGrain — the tile says what the heading does not (OR-56 b)', () => {
  it('names the weekday under a month’s heading, which names the month and its year', () => {
    expect(S.tileGrain(false, 'MONTH')).toEqual({ namesMonth: false });
  });

  it('names the month under a year’s heading, which names the year', () => {
    expect(S.tileGrain(false, 'YEAR')).toEqual({ namesMonth: true });
  });

  it('names the month in the upcoming run, whose heading names no period — whatever the list’s grain, and never the year (DEP-F39)', () => {
    // «сб / 1» for 1 June 2030 named no month; the 44 pt square cannot hold
    // «юни 2030 г.», and the row's accessible name keeps the year (R59).
    for (const grain of ['MONTH', 'YEAR'] as const) {
      expect(S.tileGrain(true, grain)).toEqual({ namesMonth: true });
    }
  });

  it('files and captions alike: every row the upcoming run holds names its month', () => {
    for (const upcoming of [true, false]) {
      for (const grain of ['MONTH', 'YEAR'] as const) {
        const filed =
          S.rowSectionKey(upcoming, localDate('2030-06-01'), grain) ===
          UPCOMING_SECTION_KEY;
        expect(!filed || S.tileGrain(upcoming, grain).namesMonth).toBe(true);
      }
    }
  });

  it('is pure: same input → same output', () => {
    for (const upcoming of [true, false]) {
      for (const grain of ['MONTH', 'YEAR'] as const) {
        expect(S.tileGrain(upcoming, grain)).toEqual(
          S.tileGrain(upcoming, grain),
        );
      }
    }
  });
});

describe('VisitListSystem.showsPills — a rail only where a pill has somewhere to jump (OR-56 c)', () => {
  const section = (key: string) => ({ key });

  it('draws no rail over no section, nor over one — one pill would name the one heading right under it', () => {
    expect(S.showsPills([])).toBe(false);
    expect(S.showsPills([section(UPCOMING_SECTION_KEY)])).toBe(false);
    expect(S.showsPills([section('2026-09')])).toBe(false);
  });

  it('draws the rail from two sections up', () => {
    expect(
      S.showsPills([section(UPCOMING_SECTION_KEY), section('2026-09')]),
    ).toBe(true);
    expect(
      S.showsPills([
        section('2026-09'),
        section('2026-08'),
        section('2026-07'),
      ]),
    ).toBe(true);
  });

  it('counts the sections a list draws, as `sections` builds them', () => {
    const one = S.sections(
      [row('next', '2030-06-01T10:00:00', { upcoming: true })],
      'MONTH',
    );
    expect(S.showsPills(one)).toBe(false);
    const two = S.sections(
      [
        row('next', '2030-06-01T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      'MONTH',
    );
    expect(S.showsPills(two)).toBe(true);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const sections = deepFreeze([section('upcoming'), section('2026-09')]);
    const once = S.showsPills(sections);
    expect(S.showsPills(sections)).toBe(once);
    expect(sections.map((entry) => entry.key)).toEqual(['upcoming', '2026-09']);
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

  it('breaks a tie on an equal day and minute by the row’s id, in code units — never by the input order (OR-18, DEP-F13)', () => {
    // The input says «z» first; the ids sort «a» first, and «a» leads.
    const items = [
      item('first-in', '2026-10-02T10:00:00', true, 'z'),
      item('second-in', '2026-10-02T10:00:00', true, 'a'),
    ];
    expect(keys(S.upcomingSoonestFirst(items, rowOf))).toEqual([
      'second-in',
      'first-in',
    ]);
    // Reversed input, the same order: the ids decide, not the caller.
    expect(keys(S.upcomingSoonestFirst([...items].reverse(), rowOf))).toEqual([
      'second-in',
      'first-in',
    ]);
    // Code units, not the device's collation: «Z» (U+005A) before «a».
    const cased = [
      item('lower', '2026-10-02T10:00:00', true, 'a'),
      item('upper', '2026-10-02T10:00:00', true, 'Z'),
    ];
    expect(keys(S.upcomingSoonestFirst(cased, rowOf))).toEqual([
      'upper',
      'lower',
    ]);
    // The list's own upcoming run breaks the same tie the same way.
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

/*
 * HAS THE VISIT BEGUN, AND THE HISTORY'S ADMISSION (pass C, C-22) — ported
 * from `appointments.store.ts`'s `history` filter (`isSettled ∨ start ≤ now`
 * on the shop's wall clock); `appointments.store.spec.ts` pins a visit at
 * its start minute as begun on purpose.
 */
describe('VisitListSystem.hasStarted / isHistory — begun, and the history’s admission', () => {
  /** "Now" as the fixture shop sees it, at `YYYY-MM-DDTHH:MM`. */
  const nowAt = (local: string) =>
    ZonedTimeSystem.shopNow(utcMs(`${local}:00+03:00`), FIXTURE_TIME_ZONE);
  const NOW_9 = nowAt('2026-09-28T09:00');
  const wallAt = (day: string, at: number) =>
    WallTime.of(localDate(day), minute(at));
  const visitAt = (bookingStatus: BookingStatus, day: string, at: number) => ({
    bookingStatus,
    localDate: localDate(day),
    startMinutes: minute(at),
  });

  it('has begun at the start minute and after it, on the shop’s wall clock', () => {
    expect(S.hasStarted(wallAt('2026-09-28', 540), NOW_9)).toBe(true);
    expect(S.hasStarted(wallAt('2026-09-28', 539), NOW_9)).toBe(true);
    expect(S.hasStarted(wallAt('2026-09-27', 1439), NOW_9)).toBe(true);
  });

  it('has not begun a minute before, nor on a later day', () => {
    expect(S.hasStarted(wallAt('2026-09-28', 541), NOW_9)).toBe(false);
    expect(S.hasStarted(wallAt('2026-09-29', 0), NOW_9)).toBe(false);
  });

  it('admits every settled visit, whenever it starts', () => {
    for (const bookingStatus of [
      BookingStatus.Completed,
      BookingStatus.Cancelled,
      BookingStatus.NoShow,
    ]) {
      expect(
        S.isHistory(visitAt(bookingStatus, '2026-10-05', 600), NOW_9),
      ).toBe(true);
    }
  });

  it('admits an open visit once begun — at 09:00 sharp it is begun', () => {
    for (const bookingStatus of [
      BookingStatus.Pending,
      BookingStatus.Confirmed,
    ]) {
      expect(
        S.isHistory(visitAt(bookingStatus, '2026-09-28', 540), NOW_9),
      ).toBe(true);
      expect(
        S.isHistory(visitAt(bookingStatus, '2026-09-27', 600), NOW_9),
      ).toBe(true);
      expect(
        S.isHistory(visitAt(bookingStatus, '2026-09-28', 541), NOW_9),
      ).toBe(false);
      expect(S.isHistory(visitAt(bookingStatus, '2026-09-29', 0), NOW_9)).toBe(
        false,
      );
    }
  });

  it('composes the one rule — an open visit is history exactly when it has started', () => {
    for (const [day, at] of [
      ['2026-09-27', 600],
      ['2026-09-28', 539],
      ['2026-09-28', 540],
      ['2026-09-28', 541],
      ['2026-09-29', 0],
    ] as const) {
      expect(
        S.isHistory(visitAt(BookingStatus.Confirmed, day, at), NOW_9),
      ).toBe(S.hasStarted(wallAt(day, at), NOW_9));
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visit = deepFreeze(
      visitAt(BookingStatus.Confirmed, '2026-09-28', 540),
    );
    const now = deepFreeze(NOW_9);
    const start = deepFreeze(wallAt('2026-09-28', 540));
    expect(S.isHistory(visit, now)).toBe(S.isHistory(visit, now));
    expect(S.hasStarted(start, now)).toBe(S.hasStarted(start, now));
    expect(visit).toEqual(visitAt(BookingStatus.Confirmed, '2026-09-28', 540));
  });
});

/*
 * OR-8 — «Предстоящ час» and the menu badge judge each visit on its OWN
 * shop's wall clock: a CONFIRMED visit that has begun there is no longer
 * upcoming (DEP-F7), and a visit whose shop zone is unknown is skipped.
 */
describe('VisitListSystem.nextUpcoming / countUpcoming — the next visit to come, on its own shop’s clock', () => {
  const SOFIA_SHOP = LocationId.of('loc-sofia');
  const UTC_SHOP = LocationId.of('loc-utc');
  const UNKNOWN_SHOP = LocationId.of('loc-unknown');
  // 06:00 UTC on 2026-09-28: 09:00 in Sofia (+03:00), 06:00 at the UTC shop.
  const INSTANT = utcMs('2026-09-28T06:00:00Z');
  const ZONES = new Map<LocationId, TimeZone>([
    [SOFIA_SHOP, FIXTURE_TIME_ZONE],
    [UTC_SHOP, TimeZone.UTC],
  ]);
  const nowOf = (locationId: LocationId): ShopNow | null => {
    const zone = ZONES.get(locationId);
    return zone === undefined ? null : ZonedTimeSystem.shopNow(INSTANT, zone);
  };
  const visit = (
    key: string,
    bookingStatus: BookingStatus,
    locationId: LocationId,
    day: string,
    at: number,
  ) => ({
    key,
    id: AppointmentId.of(key),
    bookingStatus,
    locationId,
    localDate: localDate(day),
    startMinutes: minute(at),
  });
  type Visit = ReturnType<typeof visit>;
  const keyOf = (found: Visit | null) => found?.key ?? null;

  it('skips a CONFIRMED visit that has begun on its shop’s clock — the start minute counts as begun', () => {
    const items = [
      visit('begun', BookingStatus.Confirmed, SOFIA_SHOP, '2026-09-28', 480),
      visit('at-nine', BookingStatus.Confirmed, SOFIA_SHOP, '2026-09-28', 540),
      visit('later', BookingStatus.Confirmed, SOFIA_SHOP, '2026-09-28', 541),
    ];
    expect(keyOf(S.nextUpcoming(items, nowOf))).toBe('later');
    expect(S.countUpcoming(items, nowOf)).toBe(1);
  });

  it('skips a PENDING visit that has begun just the same, and keeps one still to come', () => {
    const items = [
      visit('begun', BookingStatus.Pending, SOFIA_SHOP, '2026-09-28', 500),
      visit('to-come', BookingStatus.Pending, SOFIA_SHOP, '2026-09-29', 600),
    ];
    expect(keyOf(S.nextUpcoming(items, nowOf))).toBe('to-come');
    expect(S.countUpcoming(items, nowOf)).toBe(1);
  });

  it('skips every settled visit, however far ahead it starts', () => {
    const items = [
      BookingStatus.Completed,
      BookingStatus.Cancelled,
      BookingStatus.NoShow,
    ].map((status) => visit(status, status, SOFIA_SHOP, '2026-10-05', 600));
    expect(S.nextUpcoming(items, nowOf)).toBeNull();
    expect(S.countUpcoming(items, nowOf)).toBe(0);
  });

  it('judges two shops in two zones each on its own clock', () => {
    // 08:30 has begun in Sofia (09:00 there); 07:00 is still to come at the
    // UTC shop (06:00 there) — one clock for both would drop the second.
    const items = [
      visit('sofia', BookingStatus.Confirmed, SOFIA_SHOP, '2026-09-28', 510),
      visit('utc', BookingStatus.Confirmed, UTC_SHOP, '2026-09-28', 420),
    ];
    expect(keyOf(S.nextUpcoming(items, nowOf))).toBe('utc');
    expect(S.countUpcoming(items, nowOf)).toBe(1);
  });

  it('skips a visit whose shop zone is unknown', () => {
    const items = [
      visit('unknown', BookingStatus.Confirmed, UNKNOWN_SHOP, '2026-09-29', 0),
      visit('known', BookingStatus.Confirmed, SOFIA_SHOP, '2026-09-30', 600),
    ];
    expect(keyOf(S.nextUpcoming(items, nowOf))).toBe('known');
    expect(S.countUpcoming(items, nowOf)).toBe(1);
    expect(S.nextUpcoming(items.slice(0, 1), nowOf)).toBeNull();
  });

  it('takes the soonest in any input order, the code-unit smaller id on a tie (OR-18)', () => {
    const items = [
      visit('later', BookingStatus.Confirmed, SOFIA_SHOP, '2026-10-20', 600),
      visit(
        'first-tie',
        BookingStatus.Confirmed,
        SOFIA_SHOP,
        '2026-10-02',
        600,
      ),
      visit('second-tie', BookingStatus.Pending, SOFIA_SHOP, '2026-10-02', 600),
      visit('next-day', BookingStatus.Confirmed, SOFIA_SHOP, '2026-10-03', 0),
    ];
    // 'first-tie' < 'second-tie' in UTF-16 code units: the same answer in
    // either order — the first row `upcomingSoonestFirst` draws.
    expect(keyOf(S.nextUpcoming(items, nowOf))).toBe('first-tie');
    expect(keyOf(S.nextUpcoming([...items].reverse(), nowOf))).toBe(
      'first-tie',
    );
    expect(S.countUpcoming(items, nowOf)).toBe(4);
  });

  it('answers nothing for nothing', () => {
    expect(S.nextUpcoming([], nowOf)).toBeNull();
    expect(S.countUpcoming([], nowOf)).toBe(0);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const items = deepFreeze([
      visit('b', BookingStatus.Confirmed, SOFIA_SHOP, '2026-10-04', 600),
      visit('a', BookingStatus.Confirmed, UTC_SHOP, '2026-09-28', 420),
      visit('c', BookingStatus.Cancelled, SOFIA_SHOP, '2026-10-02', 600),
    ]);
    const once = S.nextUpcoming(items, nowOf);
    expect(S.nextUpcoming(items, nowOf)).toBe(once);
    expect(keyOf(once)).toBe('a');
    expect(S.countUpcoming(items, nowOf)).toBe(S.countUpcoming(items, nowOf));
    expect(items.map((entry) => entry.key)).toEqual(['b', 'a', 'c']);
  });
});
