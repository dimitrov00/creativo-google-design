import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AppointmentId,
  LocalDate,
  MinuteOfDay,
  WaitlistRequestId,
} from '@core/primitives';
import { describe, expect, it } from 'vitest';
import {
  matchesVisitFilter,
  offeredVisitFilters,
  visitFilterWordKey,
  visitFiltersFor,
} from './visit-filter';
import {
  VisitFilter,
  VisitPerspective,
  VisitRowEntry,
  type VisitRowFields,
  VisitRowOutcome,
  type VisitRowVm,
} from './visit-row.vm';

/** A row as the funnel reads it: whether it is ahead, and how it went. */
function row(
  id: string,
  upcoming: boolean,
  outcome: VisitRowOutcome | null,
  visitRowEntry: VisitRowEntry = VisitRowEntry.Visit,
): VisitRowVm {
  const waiting = visitRowEntry === VisitRowEntry.Waitlist;
  const fields: VisitRowFields = {
    localDate: LocalDate.fromEpochDay(0),
    startMinutes: MinuteOfDay.ofProven(0),
    sectionKey: upcoming ? 'upcoming' : '2026-09',
    upcoming,
    tile: waiting ? null : { caption: 'пт', day: 4, tone: 'past' },
    leadingIcon: waiting ? 'calendar.watching' : null,
    title: 'Фейд',
    struck:
      outcome === VisitRowOutcome.Cancelled ||
      outcome === VisitRowOutcome.NoShow,
    lines: [],
    quote: null,
    trailing: null,
    trailingFact: null,
    marks: [],
    outcome,
    bookingStatus: null,
    accessibleName: id,
    testId: id,
  };
  return waiting
    ? {
        ...fields,
        id: WaitlistRequestId.of(id),
        visitRowEntry: VisitRowEntry.Waitlist,
      }
    : {
        ...fields,
        id: AppointmentId.of(id),
        visitRowEntry: VisitRowEntry.Visit,
      };
}

const ROWS: readonly VisitRowVm[] = [
  row('ahead', true, VisitRowOutcome.Open),
  row('waiting', true, null, VisitRowEntry.Waitlist),
  row('worked', false, VisitRowOutcome.Worked),
  row('no-show', false, VisitRowOutcome.NoShow),
  row('cancelled', false, VisitRowOutcome.Cancelled),
  // A past hour nobody settled: none of the three outcomes, not ahead.
  row('unsettled', false, VisitRowOutcome.Open),
];

const kept = (filter: VisitFilter) =>
  ROWS.filter((entry) => matchesVisitFilter(entry, filter)).map(
    (entry) => entry.id,
  );

describe('matchesVisitFilter', () => {
  it('keeps every row unfiltered', () => {
    expect(kept(VisitFilter.All)).toEqual(ROWS.map((entry) => entry.id));
  });

  it('keeps the run ahead under «Предстоящи», a waiting request included', () => {
    expect(kept(VisitFilter.Upcoming)).toEqual(['ahead', 'waiting']);
  });

  it('narrows the past to the one outcome each terminal filter names', () => {
    expect(kept(VisitFilter.Completed)).toEqual(['worked']);
    expect(kept(VisitFilter.NoShow)).toEqual(['no-show']);
    expect(kept(VisitFilter.Cancelled)).toEqual(['cancelled']);
  });

  it('reads the row’s OWN outcome — the subject’s on the staff card', () => {
    // A companion no-showed on a visit the subject was worked on: the
    // subject's row is `worked`, and «Неявявания» must not list it.
    const party = row('party', false, VisitRowOutcome.Worked);
    expect(matchesVisitFilter(party, VisitFilter.NoShow)).toBe(false);
    expect(matchesVisitFilter(party, VisitFilter.Completed)).toBe(true);
  });
});

describe('visitFiltersFor', () => {
  it('offers the client’s options in the order their list always read', () => {
    expect(visitFiltersFor(VisitPerspective.Client)).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.Cancelled,
      VisitFilter.NoShow,
    ]);
  });

  it('offers the staff history’s options as its spec lists them', () => {
    expect(visitFiltersFor(VisitPerspective.Staff)).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ]);
  });
});

describe('offeredVisitFilters', () => {
  const past = ROWS.filter((entry) => !entry.upcoming);
  const workedOnly = [row('worked', false, VisitRowOutcome.Worked)];

  it('offers every option a row answers, in the menu’s order', () => {
    expect(
      offeredVisitFilters(VisitPerspective.Staff, ROWS, { complete: true }),
    ).toEqual(visitFiltersFor(VisitPerspective.Staff));
    expect(
      offeredVisitFilters(VisitPerspective.Client, ROWS, { complete: true }),
    ).toEqual(visitFiltersFor(VisitPerspective.Client));
  });

  it('leaves out what no row answers once the book is read to its end — «Всички» always stays', () => {
    const withNoShow = [
      ...workedOnly,
      row('missed', false, VisitRowOutcome.NoShow),
    ];
    expect(
      offeredVisitFilters(VisitPerspective.Staff, withNoShow, {
        complete: true,
      }),
    ).toEqual([VisitFilter.All, VisitFilter.Completed, VisitFilter.NoShow]);
    expect(
      offeredVisitFilters(VisitPerspective.Staff, [], { complete: true }),
    ).toEqual([VisitFilter.All]);
  });

  it('leaves out what every row answers once the book is read to its end: a choice that narrows nothing', () => {
    // Every visit worked and none is ahead: «Минали» would show the same
    // rows, so only «Всички» is left and the host shows no funnel.
    const worked = [
      ...workedOnly,
      row('worked-2', false, VisitRowOutcome.Worked),
      row('worked-3', false, VisitRowOutcome.Worked),
    ];
    expect(
      offeredVisitFilters(VisitPerspective.Staff, worked, { complete: true }),
    ).toEqual([VisitFilter.All]);
    expect(
      offeredVisitFilters(VisitPerspective.Client, worked, { complete: true }),
    ).toEqual([VisitFilter.All]);
    // Nothing but what is ahead: «Предстоящи» narrows nothing either.
    const ahead = [
      row('next', true, VisitRowOutcome.Open),
      row('waiting', true, null, VisitRowEntry.Waitlist),
    ];
    expect(
      offeredVisitFilters(VisitPerspective.Staff, ahead, { complete: true }),
    ).toEqual([VisitFilter.All]);
    // One hour ahead is enough for both to narrow.
    expect(
      offeredVisitFilters(
        VisitPerspective.Staff,
        [...worked, row('next', true, VisitRowOutcome.Open)],
        {
          complete: true,
        },
      ),
    ).toEqual([VisitFilter.All, VisitFilter.Upcoming, VisitFilter.Completed]);
    // While older pages remain, an older page is a past hour, so a list of
    // upcoming rows alone still narrows under «Предстоящи».
    expect(
      offeredVisitFilters(VisitPerspective.Staff, ahead, { complete: false }),
    ).toEqual([
      VisitFilter.All,
      VisitFilter.Upcoming,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ]);
  });

  it('keeps the past outcomes while older pages remain, but «Предстоящи» is the first read’s to answer', () => {
    expect(
      offeredVisitFilters(VisitPerspective.Staff, workedOnly, {
        complete: false,
      }),
    ).toEqual([
      VisitFilter.All,
      VisitFilter.Completed,
      VisitFilter.NoShow,
      VisitFilter.Cancelled,
    ]);
    expect(
      offeredVisitFilters(VisitPerspective.Staff, past, { complete: false }),
    ).not.toContain(VisitFilter.Upcoming);
  });
});

describe('visitFilterWordKey', () => {
  const catalogue = (lang: 'bg' | 'en') =>
    JSON.parse(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
      readFileSync(
        resolve(
          __dirname,
          `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;

  const word = (tree: Record<string, unknown>, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );

  it('words the no-show by who reads it, every other option alike', () => {
    expect(
      visitFilterWordKey(VisitFilter.NoShow, VisitPerspective.Client),
    ).toBe('visits.filter.no_show');
    expect(visitFilterWordKey(VisitFilter.NoShow, VisitPerspective.Staff)).toBe(
      'visits.filter.no_show_staff',
    );
    expect(
      visitFilterWordKey(VisitFilter.Cancelled, VisitPerspective.Staff),
    ).toBe('visits.filter.cancelled');
  });

  it('names a word both catalogues carry, for every option of both menus', () => {
    const bg = catalogue('bg');
    const en = catalogue('en');
    for (const perspective of [
      VisitPerspective.Client,
      VisitPerspective.Staff,
    ]) {
      for (const filter of visitFiltersFor(perspective)) {
        const key = visitFilterWordKey(filter, perspective);
        expect(typeof word(bg, key), `bg ${key}`).toBe('string');
        expect(typeof word(en, key), `en ${key}`).toBe('string');
      }
    }
    expect(word(bg, 'visits.filter.no_show')).toBe('Пропуснати');
    expect(word(bg, 'visits.filter.no_show_staff')).toBe('Неявявания');
  });
});
