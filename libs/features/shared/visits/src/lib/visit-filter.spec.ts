import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  matchesVisitFilter,
  offeredVisitFilters,
  visitFilterWordKey,
  visitFiltersFor,
} from './visit-filter';
import type { VisitFilter, VisitRowOutcome, VisitRowVm } from './visit-row.vm';

/** A row as the funnel reads it: whether it is ahead, and how it went. */
function row(
  id: string,
  upcoming: boolean,
  outcome: VisitRowOutcome | null,
  kind: VisitRowVm['kind'] = 'visit',
): VisitRowVm {
  return {
    id,
    kind,
    startMs: 0,
    sectionKey: upcoming ? 'upcoming' : '2026-09',
    upcoming,
    tile: kind === 'waitlist' ? null : { caption: 'пт', day: 4, tone: 'past' },
    leadingIcon: kind === 'waitlist' ? 'calendar.watching' : null,
    title: 'Фейд',
    struck: outcome === 'cancelled' || outcome === 'no_show',
    lines: [],
    quote: null,
    trailing: null,
    trailingFact: null,
    marks: [],
    outcome,
    status: null,
    accessibleName: id,
    testId: id,
  };
}

const ROWS: readonly VisitRowVm[] = [
  row('ahead', true, 'open'),
  row('waiting', true, null, 'waitlist'),
  row('worked', false, 'worked'),
  row('no-show', false, 'no_show'),
  row('cancelled', false, 'cancelled'),
  // A past hour nobody settled: none of the three outcomes, not ahead.
  row('unsettled', false, 'open'),
];

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
    const party = row('party', false, 'worked');
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
  const workedOnly = [row('worked', false, 'worked')];

  it('offers every option a row answers, in the menu’s order', () => {
    expect(offeredVisitFilters('staff', ROWS, { complete: true })).toEqual(
      visitFiltersFor('staff'),
    );
    expect(offeredVisitFilters('client', ROWS, { complete: true })).toEqual(
      visitFiltersFor('client'),
    );
  });

  it('leaves out what no row answers once the book is read to its end — «Всички» always stays', () => {
    const withNoShow = [...workedOnly, row('missed', false, 'no_show')];
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
      row('worked-2', false, 'worked'),
      row('worked-3', false, 'worked'),
    ];
    expect(offeredVisitFilters('staff', worked, { complete: true })).toEqual([
      'all',
    ]);
    expect(offeredVisitFilters('client', worked, { complete: true })).toEqual([
      'all',
    ]);
    // Nothing but what is ahead: «Предстоящи» narrows nothing either.
    const ahead = [
      row('next', true, 'open'),
      row('waiting', true, null, 'waitlist'),
    ];
    expect(offeredVisitFilters('staff', ahead, { complete: true })).toEqual([
      'all',
    ]);
    // One hour ahead is enough for both to narrow.
    expect(
      offeredVisitFilters('staff', [...worked, row('next', true, 'open')], {
        complete: true,
      }),
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
    expect(visitFilterWordKey('no_show', 'client')).toBe(
      'visits.filter.no_show',
    );
    expect(visitFilterWordKey('no_show', 'staff')).toBe(
      'visits.filter.no_show_staff',
    );
    expect(visitFilterWordKey('cancelled', 'staff')).toBe(
      'visits.filter.cancelled',
    );
  });

  it('names a word both catalogues carry, for every option of both menus', () => {
    const bg = catalogue('bg');
    const en = catalogue('en');
    for (const perspective of ['client', 'staff'] as const) {
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
