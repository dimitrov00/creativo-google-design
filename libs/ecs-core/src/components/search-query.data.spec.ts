import { describe, expect, it } from 'vitest';
import {
  BarberId,
  BookingStatus,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';
import { SearchQueryErrorCode } from '@core/errors';
import { deepFreeze, localDate, unwrapOk } from '@core/testing';
import { SearchFilter, SearchFilterField } from './search-filter.data';
import { SearchQuery } from './search-query.data';
import { ServiceVariantPick } from './service-variant-pick.data';

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const FADE = ServiceId.of('svc-fade');

const barberIds = (query: SearchQuery): readonly BarberId[] => {
  const filter = query.searchFilters.find(
    (held) => held.searchFilterField === SearchFilterField.Barber,
  );
  return filter?.searchFilterField === SearchFilterField.Barber
    ? filter.filterBarberIds
    : [];
};

describe('SearchQuery — the companion', () => {
  it('starts empty, and is empty with blanks only', () => {
    expect(SearchQuery.isEmpty(SearchQuery.empty())).toBe(true);
    expect(
      SearchQuery.isEmpty(SearchQuery.withText(SearchQuery.empty(), '  ')),
    ).toBe(true);
    expect(
      SearchQuery.isEmpty(SearchQuery.withText(SearchQuery.empty(), 'иван')),
    ).toBe(false);
    expect(
      SearchQuery.isEmpty(
        SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      ),
    ).toBe(false);
  });

  it('merges a second filter of one kind into the first (ids united, no duplicates)', () => {
    let query = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.barber([IVAN]),
    );
    query = SearchQuery.withFilter(query, SearchFilter.barber([NIKO, IVAN]));
    expect(query.searchFilters).toHaveLength(1);
    expect(barberIds(query)).toEqual([IVAN, NIKO]);
  });

  it('keeps one filter per kind, in the order the kinds were added', () => {
    let query = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.note(),
    );
    query = SearchQuery.withFilter(query, SearchFilter.service([FADE], []));
    query = SearchQuery.withFilter(query, SearchFilter.barber([IVAN]));
    query = SearchQuery.withFilter(query, SearchFilter.service([FADE], []));
    expect(query.searchFilters.map((f) => f.searchFilterField)).toEqual([
      SearchFilterField.Note,
      SearchFilterField.Service,
      SearchFilterField.Barber,
    ]);
  });

  it('is the same search whatever order its filters were added in', () => {
    const a = SearchQuery.withFilter(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.note()),
      SearchFilter.barber([IVAN]),
    );
    const b = SearchQuery.withFilter(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.barber([IVAN])),
      SearchFilter.note(),
    );
    expect(SearchQuery.equals(a, b)).toBe(true);
  });

  it('replaces a date span and the note flag, not merges them', () => {
    let query = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.when(localDate('2026-08-05'), localDate('2026-08-05')),
    );
    query = SearchQuery.withFilter(
      query,
      SearchFilter.when(localDate('2026-08-06'), localDate('2026-08-12')),
    );
    expect(query.searchFilters).toEqual([
      SearchFilter.when(localDate('2026-08-06'), localDate('2026-08-12')),
    ]);
  });

  it('removes the last id of a kind together with its filter', () => {
    let query = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.barber([IVAN, NIKO]),
    );
    query = SearchQuery.withoutFilterValue(query, SearchFilter.barber([IVAN]));
    expect(barberIds(query)).toEqual([NIKO]);
    query = SearchQuery.withoutFilterValue(query, SearchFilter.barber([NIKO]));
    expect(query.searchFilters).toEqual([]);
  });

  it('removes a date span or the note flag whole, and a kind on request', () => {
    let query = SearchQuery.withFilter(
      SearchQuery.empty(),
      SearchFilter.note(),
    );
    query = SearchQuery.withFilter(query, SearchFilter.barber([IVAN]));
    expect(
      SearchQuery.withoutFilterValue(
        query,
        SearchFilter.note(),
      ).searchFilters.map((f) => f.searchFilterField),
    ).toEqual([SearchFilterField.Barber]);
    expect(
      SearchQuery.withoutFilter(
        query,
        SearchFilterField.Barber,
      ).searchFilters.map((f) => f.searchFilterField),
    ).toEqual([SearchFilterField.Note]);
  });

  it('compares by text (trimmed) and by filters (kind and value, not order)', () => {
    const a = SearchQuery.withFilter(
      SearchQuery.withText(SearchQuery.empty(), 'иван '),
      SearchFilter.barber([IVAN, NIKO]),
    );
    const b = SearchQuery.withFilter(
      SearchQuery.withText(SearchQuery.empty(), 'иван'),
      SearchFilter.barber([NIKO, IVAN]),
    );
    expect(SearchQuery.equals(a, b)).toBe(true);
    expect(SearchQuery.equals(a, SearchQuery.withText(a, 'иван петров'))).toBe(
      false,
    );
    expect(
      SearchQuery.equals(a, SearchQuery.withFilter(a, SearchFilter.note())),
    ).toBe(false);
  });

  it('replaces a kind’s filter where it stands, appends a new kind, and takes the kind off on null', () => {
    const held = SearchQuery.withFilter(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.barber([IVAN])),
      SearchFilter.note(),
    );
    const replaced = SearchQuery.withFilterReplaced(
      held,
      SearchFilterField.Barber,
      SearchFilter.barber([NIKO]),
    );
    // In place: the barbers stay first, and Ivan is gone, not merged.
    expect(replaced.searchFilters.map((f) => f.searchFilterField)).toEqual([
      SearchFilterField.Barber,
      SearchFilterField.Note,
    ]);
    expect(barberIds(replaced)).toEqual([NIKO]);
    expect(
      SearchQuery.withFilterReplaced(
        held,
        SearchFilterField.Service,
        SearchFilter.service([FADE], []),
      ).searchFilters.map((f) => f.searchFilterField),
    ).toEqual([
      SearchFilterField.Barber,
      SearchFilterField.Note,
      SearchFilterField.Service,
    ]);
    expect(
      SearchQuery.withFilterReplaced(held, SearchFilterField.Barber, null)
        .searchFilters,
    ).toEqual([SearchFilter.note()]);
  });

  it('keeps a service filter’s variants beside its services, through merge, subtract and a stored round trip', () => {
    const LONG = ServiceVariantPick.of(FADE, ServiceVariantId.of('long'));
    const query = SearchQuery.withFilter(
      SearchQuery.withFilter(
        SearchQuery.empty(),
        SearchFilter.service([FADE], []),
      ),
      SearchFilter.service([], [LONG]),
    );
    expect(query.searchFilters).toEqual([SearchFilter.service([FADE], [LONG])]);
    // The same pick twice is one pick.
    expect(
      SearchQuery.withFilter(query, SearchFilter.service([], [{ ...LONG }]))
        .searchFilters,
    ).toEqual([SearchFilter.service([FADE], [LONG])]);
    expect(
      SearchQuery.withoutFilterValue(query, SearchFilter.service([FADE], []))
        .searchFilters,
    ).toEqual([SearchFilter.service([], [LONG])]);
    const stored = unwrapOk(
      SearchQuery.parse(JSON.parse(JSON.stringify(query))),
    );
    expect(stored).toEqual(query);
    // A service filter with neither services nor variants is refused.
    expect(
      SearchQuery.parse({
        searchText: '',
        searchFilters: [
          {
            searchFilterField: 'SERVICE',
            filterServiceIds: [],
            filterVariants: [],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it('says which kinds hold several values', () => {
    expect(SearchFilter.holdsMany(SearchFilterField.Barber)).toBe(true);
    expect(SearchFilter.holdsMany(SearchFilterField.Service)).toBe(true);
    expect(SearchFilter.holdsMany(SearchFilterField.Status)).toBe(true);
    expect(SearchFilter.holdsMany(SearchFilterField.When)).toBe(false);
    expect(SearchFilter.holdsMany(SearchFilterField.Note)).toBe(false);
  });

  it('does not change the query it was given', () => {
    const query = deepFreeze(
      SearchQuery.withFilter(SearchQuery.empty(), SearchFilter.barber([IVAN])),
    );
    SearchQuery.withFilter(query, SearchFilter.barber([NIKO]));
    SearchQuery.withoutFilterValue(query, SearchFilter.barber([IVAN]));
    SearchQuery.withFilterReplaced(query, SearchFilterField.Barber, null);
    expect(barberIds(query)).toEqual([IVAN]);
  });
});

describe('SearchQuery.parse — the guard of a stored search', () => {
  const full: SearchQuery = [
    SearchFilter.barber([IVAN, NIKO]),
    SearchFilter.service([FADE], []),
    SearchFilter.bookingStatuses([
      BookingStatus.Cancelled,
      BookingStatus.NoShow,
    ]),
    SearchFilter.when(localDate('2026-08-05'), localDate('2026-08-11')),
    SearchFilter.note(),
  ].reduce(
    (query, filter) => SearchQuery.withFilter(query, filter),
    SearchQuery.withText(SearchQuery.empty(), 'иван'),
  );

  it('reads back what JSON made of a query, every kind of filter', () => {
    const stored: unknown = JSON.parse(JSON.stringify(full));
    expect(unwrapOk(SearchQuery.parse(stored))).toEqual(full);
  });

  it.each([
    ['null', null, '$'],
    ['an array', [], '$'],
    ['no text', { searchFilters: [] }, 'searchText'],
    ['a numeric text', { searchText: 4, searchFilters: [] }, 'searchText'],
    [
      'filters that are no list',
      { searchText: '', searchFilters: {} },
      'searchFilters',
    ],
    [
      'a filter of a kind nobody knows',
      { searchText: '', searchFilters: [{ searchFilterField: 'COLOUR' }] },
      'searchFilters[0].searchFilterField',
    ],
    [
      'a barber filter with no ids',
      {
        searchText: '',
        searchFilters: [{ searchFilterField: 'BARBER', filterBarberIds: [] }],
      },
      'searchFilters[0].filterBarberIds',
    ],
    [
      'a blank barber id',
      {
        searchText: '',
        searchFilters: [
          { searchFilterField: 'BARBER', filterBarberIds: ['ivan', ''] },
        ],
      },
      'searchFilters[0].filterBarberIds[1]',
    ],
    [
      'a status nobody stores',
      {
        searchText: '',
        searchFilters: [
          { searchFilterField: 'STATUS', filterBookingStatuses: ['cancelled'] },
        ],
      },
      'searchFilters[0].filterBookingStatuses[0]',
    ],
    [
      'a date that is not one',
      {
        searchText: '',
        searchFilters: [
          {
            searchFilterField: 'WHEN',
            filterFromDate: '2026-02-30',
            filterToDate: '2026-03-01',
          },
        ],
      },
      'searchFilters[0].filterFromDate',
    ],
    [
      'a span that ends before it starts',
      {
        searchText: '',
        searchFilters: [
          {
            searchFilterField: 'WHEN',
            filterFromDate: '2026-08-10',
            filterToDate: '2026-08-05',
          },
        ],
      },
      'searchFilters[0].filterToDate',
    ],
    [
      'a note flag that is false',
      {
        searchText: '',
        searchFilters: [{ searchFilterField: 'NOTE', filterHasNote: false }],
      },
      'searchFilters[0].filterHasNote',
    ],
  ])('refuses %s, naming the first bad part', (_what, raw, field) => {
    const answer = SearchQuery.parse(raw);
    expect(answer).toEqual({
      ok: false,
      error: { errorCode: SearchQueryErrorCode.Invalid, field },
    });
  });

  it('merges two stored filters of one kind into one', () => {
    const query = unwrapOk(
      SearchQuery.parse({
        searchText: '',
        searchFilters: [
          { searchFilterField: 'BARBER', filterBarberIds: ['ivan'] },
          { searchFilterField: 'BARBER', filterBarberIds: ['niko'] },
        ],
      }),
    );
    expect(barberIds(query)).toEqual([IVAN, NIKO]);
  });
});
