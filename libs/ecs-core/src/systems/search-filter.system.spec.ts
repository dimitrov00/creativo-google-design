import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  SearchFilter,
  SearchFilterField,
  SearchWhenPreset,
  ServiceVariantPick,
  type ShopNow,
} from '@core/components';
import {
  type BarberId,
  BookingStatus,
  LocalDate,
  type ServiceId,
  ServiceVariantId,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_NOW,
  FIXTURE_TODAY,
  SEARCH_BARBERS,
  SEARCH_SERVICES,
  appointmentFixture,
  deepFreeze,
  searchWindowFixture,
  seatFixture,
} from '@core/testing';
import { PhoneSystem } from './phone.system';
import { SearchFilterSystem } from './search-filter.system';
import { SearchIndexSystem } from './search-index.system';
import { SearchQuerySystem } from './search-query.system';
import { TextMatchSystem } from './text-match.system';

const CC = '359';
const NOW: ShopNow = FIXTURE_NOW;
const window = searchWindowFixture(400, 7);
const index = SearchIndexSystem.build(window.visits, window.labels);
const read = (raw: string) => SearchQuerySystem.read(raw, CC);

/** The same answer from the visits themselves, slowly: the reference the scan must equal. */
function bruteKeep(
  raw: string,
  filters: readonly SearchFilter[],
  skip: SearchFilterField | null = null,
): readonly number[] {
  const query = read(raw);
  const out: number[] = [];
  window.visits.forEach((visit, at) => {
    const fields = [
      ...window.labels.clientNames(visit),
      ...visit.seats.map((seat) => window.labels.serviceName(seat.serviceId)),
      ...visit.barberIds.map((id) => window.labels.barberName(id)),
      visit.contactEmail,
      visit.contactNote,
    ].map((text) => TextMatchSystem.fold(text ?? ''));
    const textOk = query.queryTerms.every((term) =>
      fields.some((field) => field.includes(term)),
    );
    const phoneOk =
      query.queryPhone.phoneReadingCandidates.length === 0 ||
      PhoneSystem.readingMatches(query.queryPhone, visit.contactPhone ?? '');
    const filtersOk = filters.every((filter) => {
      if (filter.searchFilterField === skip) return true;
      switch (filter.searchFilterField) {
        case SearchFilterField.Barber:
          return visit.barberIds.some((id) =>
            filter.filterBarberIds.includes(id),
          );
        case SearchFilterField.Service:
          return visit.seats.some(
            (seat) =>
              filter.filterServiceIds.includes(seat.serviceId) ||
              (seat.variantId !== null &&
                filter.filterVariants.some(
                  (pick) =>
                    pick.serviceId === seat.serviceId &&
                    pick.variantId === seat.variantId,
                )),
          );
        case SearchFilterField.Status:
          return filter.filterBookingStatuses.includes(visit.bookingStatus);
        case SearchFilterField.When:
          return (
            visit.localDate >= filter.filterFromDate &&
            visit.localDate <= filter.filterToDate
          );
        case SearchFilterField.Note:
          return (visit.contactNote ?? '').length > 0;
      }
    });
    if (textOk && phoneOk && filtersOk) out.push(at);
  });
  return out;
}

const IVAN = SEARCH_BARBERS[0]!.id;
const NIKO = SEARCH_BARBERS[1]!.id;

describe('SearchFilterSystem.keep — the scan', () => {
  it('keeps every visit of an empty query, ascending', () => {
    expect(SearchFilterSystem.keep(index, read(''), [])).toEqual(
      window.visits.map((_, at) => at),
    );
  });

  it('keeps the visits a name matches, in any text field', () => {
    const kept = SearchFilterSystem.keep(index, read('иван'), []);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toEqual(bruteKeep('иван', []));
  });

  it('needs every term, each in some field', () => {
    const both = SearchFilterSystem.keep(index, read('иван фейд'), []);
    const one = SearchFilterSystem.keep(index, read('иван'), []);
    expect(both.length).toBeLessThan(one.length);
    expect(both).toEqual(bruteKeep('иван фейд', []));
  });

  it('matches a number against the phone, together with the terms', () => {
    const target = window.visits.find(
      (v) => v.contactPhone !== null,
    ) as Appointment;
    const national = `0${(target.contactPhone as string).slice(4, 10)}`;
    const kept = SearchFilterSystem.keep(index, read(national), []);
    expect(kept).toContain(window.visits.indexOf(target));
    expect(kept).toEqual(bruteKeep(national, []));
  });

  it('combines kinds with AND and ids of one kind with OR', () => {
    const filters = [
      SearchFilter.barber([IVAN, NIKO]),
      SearchFilter.bookingStatuses([
        BookingStatus.Cancelled,
        BookingStatus.NoShow,
      ]),
    ];
    const kept = SearchFilterSystem.keep(index, read(''), filters);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toEqual(bruteKeep('', filters));
    for (const at of kept) {
      expect(
        [IVAN, NIKO].some((id) => window.visits[at]!.barberIds.includes(id)),
      ).toBe(true);
    }
  });

  it('filters by a date span (inclusive) and by a note', () => {
    const filters = [
      SearchFilter.when(FIXTURE_TODAY, LocalDate.addDays(FIXTURE_TODAY, 6)),
      SearchFilter.note(),
    ];
    const kept = SearchFilterSystem.keep(index, read(''), filters);
    expect(kept).toEqual(bruteKeep('', filters));
  });

  it('equals the slow reference for random queries and filters (property)', () => {
    const word = fc.constantFrom(
      'иван',
      'георги',
      'фейд',
      'нико',
      'алергия',
      'example',
      '088',
      '0887',
    );
    const filter = fc.constantFrom<SearchFilter>(
      SearchFilter.barber([IVAN]),
      SearchFilter.service([SEARCH_SERVICES[1]!.id], []),
      SearchFilter.bookingStatuses([BookingStatus.Completed]),
      SearchFilter.note(),
      SearchFilter.when(FIXTURE_TODAY, LocalDate.addDays(FIXTURE_TODAY, 30)),
    );
    fc.assert(
      fc.property(
        fc.array(word, { maxLength: 3 }),
        fc.array(filter, { maxLength: 3 }),
        (words, filters) => {
          const raw = words.join(' ');
          const merged = filters.reduce<readonly SearchFilter[]>(
            (held, next) => {
              const same = held.find(
                (f) => f.searchFilterField === next.searchFilterField,
              );
              return same === undefined
                ? [...held, next]
                : held.map((f) =>
                    f === same ? SearchFilter.merge(f, next) : f,
                  );
            },
            [],
          );
          expect(SearchFilterSystem.keep(index, read(raw), merged)).toEqual(
            bruteKeep(raw, merged),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it('folds nothing on a keystroke: the index folded once', () => {
    const fold = vi.spyOn(TextMatchSystem, 'fold');
    SearchFilterSystem.keep(index, read('Иван Фейд'), [SearchFilter.note()]);
    SearchFilterSystem.suggestions(index, read('Иван'), [], NOW);
    expect(fold).not.toHaveBeenCalled();
    fold.mockRestore();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(searchWindowFixture(30, 3));
    const frozenIndex = deepFreeze(
      SearchIndexSystem.build(frozen.visits, frozen.labels),
    );
    const filters = deepFreeze([SearchFilter.barber([IVAN])]);
    const query = deepFreeze(read('иван'));
    expect(SearchFilterSystem.keep(frozenIndex, query, filters)).toEqual(
      SearchFilterSystem.keep(frozenIndex, query, filters),
    );
    expect(
      SearchFilterSystem.suggestions(frozenIndex, query, filters, NOW),
    ).toEqual(SearchFilterSystem.suggestions(frozenIndex, query, filters, NOW));
  });
});

describe('SearchFilterSystem.suggestions — what can still narrow the search', () => {
  it('offers the barbers, services, statuses and presets of the visits the text matches', () => {
    const offered = SearchFilterSystem.suggestions(
      index,
      read('иван'),
      [],
      NOW,
    );
    const matched = bruteKeep('иван', []).map((at) => window.visits[at]!);
    const distinct = <T>(pick: (v: Appointment) => readonly T[]) => [
      ...new Set(matched.flatMap(pick)),
    ];
    expect([...offered.barberIds].sort()).toEqual(
      distinct((v) => v.barberIds).sort(),
    );
    expect([...offered.serviceIds].sort()).toEqual(
      distinct((v) => v.seats.map((s) => s.serviceId)).sort(),
    );
    expect([...offered.bookingStatuses].sort()).toEqual(
      distinct((v) => [v.bookingStatus]).sort(),
    );
    expect(offered.hasNote).toBe(
      matched.some((v) => (v.contactNote ?? '').length > 0),
    );
  });

  it('keeps the other barbers on offer when one is chosen (its own filter off)', () => {
    const base = SearchFilterSystem.suggestions(index, read(''), [], NOW);
    const chosen = SearchFilterSystem.suggestions(
      index,
      read(''),
      [SearchFilter.barber([IVAN])],
      NOW,
    );
    expect([...chosen.barberIds].sort()).toEqual([...base.barberIds].sort());
  });

  it('narrows the other kinds by the chosen one', () => {
    const chosen = SearchFilterSystem.suggestions(
      index,
      read(''),
      [SearchFilter.bookingStatuses([BookingStatus.NoShow])],
      NOW,
    );
    const noShows = bruteKeep('', [
      SearchFilter.bookingStatuses([BookingStatus.NoShow]),
    ]).map((at) => window.visits[at]!);
    expect([...chosen.barberIds].sort()).toEqual(
      [...new Set(noShows.flatMap((v) => v.barberIds))].sort(),
    );
    expect([...chosen.bookingStatuses]).toContain(BookingStatus.Completed);
  });

  it('offers a value only if some visit keeps it: every offer yields results', () => {
    const filters = [SearchFilter.barber([IVAN])];
    const offered = SearchFilterSystem.suggestions(
      index,
      read('петър'),
      filters,
      NOW,
    );
    for (const status of offered.bookingStatuses) {
      expect(
        SearchFilterSystem.keep(index, read('петър'), [
          ...filters,
          SearchFilter.bookingStatuses([status]),
        ]).length,
      ).toBeGreaterThan(0);
    }
    for (const id of offered.serviceIds) {
      expect(
        SearchFilterSystem.keep(index, read('петър'), [
          ...filters,
          SearchFilter.service([id as ServiceId], []),
        ]).length,
      ).toBeGreaterThan(0);
    }
    for (const id of offered.barberIds as readonly BarberId[]) {
      expect(
        SearchFilterSystem.keep(index, read('петър'), [
          SearchFilter.barber([id]),
        ]).length,
      ).toBeGreaterThan(0);
    }
  });

  it('offers a date preset only when a matching visit lies in it, in preset order', () => {
    const offered = SearchFilterSystem.suggestions(index, read(''), [], NOW);
    for (const preset of offered.whenPresets) {
      const when = SearchFilterSystem.whenOf(preset, NOW);
      expect(
        SearchFilterSystem.keep(index, read(''), [when]).length,
      ).toBeGreaterThan(0);
    }
    expect(offered.whenPresets).toEqual(
      [
        SearchWhenPreset.Today,
        SearchWhenPreset.Tomorrow,
        SearchWhenPreset.Yesterday,
        SearchWhenPreset.ThisWeek,
        SearchWhenPreset.PastWeek,
      ].filter((preset) => offered.whenPresets.includes(preset)),
    );
    const none = SearchFilterSystem.suggestions(
      index,
      read('zzzz-no-such'),
      [],
      NOW,
    );
    expect(none).toEqual({
      barberIds: [],
      serviceIds: [],
      variants: [],
      bookingStatuses: [],
      whenPresets: [],
      hasNote: false,
    });
  });
});

describe('SearchFilterSystem.whenOf — the date presets', () => {
  it('builds today, tomorrow and today-through-six-days on the shop’s own day', () => {
    const today = NOW.localDate;
    expect(SearchFilterSystem.whenOf(SearchWhenPreset.Today, NOW)).toEqual(
      SearchFilter.when(today, today),
    );
    expect(SearchFilterSystem.whenOf(SearchWhenPreset.Tomorrow, NOW)).toEqual(
      SearchFilter.when(
        LocalDate.addDays(today, 1),
        LocalDate.addDays(today, 1),
      ),
    );
    expect(SearchFilterSystem.whenOf(SearchWhenPreset.ThisWeek, NOW)).toEqual(
      SearchFilter.when(today, LocalDate.addDays(today, 6)),
    );
  });

  it('builds yesterday and the six days before today through today', () => {
    const today = NOW.localDate;
    const yesterday = LocalDate.addDays(today, -1);
    expect(SearchFilterSystem.whenOf(SearchWhenPreset.Yesterday, NOW)).toEqual(
      SearchFilter.when(yesterday, yesterday),
    );
    expect(SearchFilterSystem.whenOf(SearchWhenPreset.PastWeek, NOW)).toEqual(
      SearchFilter.when(LocalDate.addDays(today, -6), today),
    );
  });

  it('crosses a month end', () => {
    const when = SearchFilterSystem.whenOf(SearchWhenPreset.ThisWeek, {
      ...NOW,
      localDate: LocalDate.addDays(FIXTURE_TODAY, 0),
    });
    expect(LocalDate.daysBetween(when.filterFromDate, when.filterToDate)).toBe(
      6,
    );
    const augustEnd = SearchFilterSystem.whenOf(SearchWhenPreset.ThisWeek, {
      ...NOW,
      localDate: LocalDate.addDays(when.filterFromDate, 0),
    });
    expect(augustEnd.filterToDate >= augustEnd.filterFromDate).toBe(true);
  });
});

describe('SearchFilterSystem.spanOf — two picked days', () => {
  it('starts at the earlier day whichever was picked first; one day twice is that day', () => {
    const today = NOW.localDate;
    const later = LocalDate.addDays(today, 3);
    expect(SearchFilterSystem.spanOf(later, today)).toEqual(
      SearchFilter.when(today, later),
    );
    expect(SearchFilterSystem.spanOf(today, later)).toEqual(
      SearchFilter.when(today, later),
    );
    expect(SearchFilterSystem.spanOf(today, today)).toEqual(
      SearchFilter.when(today, today),
    );
  });
});

describe('SearchFilterSystem — a service’s variants', () => {
  const CUT = 'svc-cut' as ServiceId;
  const CLASSIC = 'svc-classic' as ServiceId;
  const LONG = ServiceVariantId.of('long');
  const SHORT = ServiceVariantId.of('short');
  const visits = [
    appointmentFixture({
      id: 'v-long' as Appointment['id'],
      seats: [seatFixture({ serviceId: CUT, variantId: LONG })],
    }),
    appointmentFixture({
      id: 'v-short' as Appointment['id'],
      seats: [seatFixture({ serviceId: CUT, variantId: SHORT })],
    }),
    appointmentFixture({
      id: 'v-plain' as Appointment['id'],
      seats: [seatFixture({ serviceId: CUT, variantId: null })],
    }),
    // Another service with a variant of the SAME id: never the cut's «long».
    appointmentFixture({
      id: 'v-classic-long' as Appointment['id'],
      seats: [seatFixture({ serviceId: CLASSIC, variantId: LONG })],
    }),
  ];
  const folded = SearchIndexSystem.build(visits, {
    clientNames: () => [],
    serviceName: () => 'Подстрижка',
    barberName: () => null,
  });
  const cutLong = ServiceVariantPick.of(CUT, LONG);
  const cutShort = ServiceVariantPick.of(CUT, SHORT);

  it('keeps a visit booked at a picked variant OF ITS SERVICE, and every visit of a service picked whole', () => {
    expect(
      SearchFilterSystem.keep(folded, read(''), [
        SearchFilter.service([], [cutLong]),
      ]),
    ).toEqual([0]);
    expect(
      SearchFilterSystem.keep(folded, read(''), [
        SearchFilter.service([], [cutLong, cutShort]),
      ]),
    ).toEqual([0, 1]);
    expect(
      SearchFilterSystem.keep(folded, read(''), [
        SearchFilter.service([CUT], []),
      ]),
    ).toEqual([0, 1, 2]);
  });

  it('offers the variants the matching visits were booked at, each with its service, a picked one not hiding the others', () => {
    const offered = SearchFilterSystem.suggestions(
      folded,
      read(''),
      [SearchFilter.service([], [cutLong])],
      NOW,
    );
    expect(offered.variants).toEqual([
      cutLong,
      cutShort,
      ServiceVariantPick.of(CLASSIC, LONG),
    ]);
    expect(offered.serviceIds).toEqual([CUT, CLASSIC]);
  });
});

describe('SearchFilterSystem.starters — what an untouched search offers', () => {
  const offered = (
    whenPresets: readonly SearchWhenPreset[],
    barberIds: readonly BarberId[],
  ) => ({
    barberIds,
    serviceIds: [],
    variants: [],
    bookingStatuses: [],
    whenPresets,
    hasNote: false,
  });
  const [ivan, stefan, niko, petar, georgi] = [
    'ivan',
    'stefan',
    'niko',
    'petar',
    'georgi',
  ] as BarberId[];

  it('offers today and tomorrow first, then the barbers, five at most', () => {
    const starters = SearchFilterSystem.starters(
      offered(
        [
          SearchWhenPreset.Today,
          SearchWhenPreset.Tomorrow,
          SearchWhenPreset.ThisWeek,
        ],
        [ivan, stefan, niko, petar] as BarberId[],
      ),
      NOW,
    );
    expect(starters).toEqual([
      SearchFilterSystem.whenOf(SearchWhenPreset.Today, NOW),
      SearchFilterSystem.whenOf(SearchWhenPreset.Tomorrow, NOW),
      SearchFilter.barber([ivan as BarberId]),
      SearchFilter.barber([stefan as BarberId]),
      SearchFilter.barber([niko as BarberId]),
    ]);
    expect(starters).toHaveLength(SearchFilterSystem.STARTER_LIMIT);
  });

  it('skips a day the window does not reach, and the barbers fill the room', () => {
    const starters = SearchFilterSystem.starters(
      offered([SearchWhenPreset.Tomorrow], [
        ivan,
        stefan,
        niko,
        petar,
        georgi,
      ] as BarberId[]),
      NOW,
    );
    expect(starters[0]).toEqual(
      SearchFilterSystem.whenOf(SearchWhenPreset.Tomorrow, NOW),
    );
    expect(starters.slice(1)).toEqual(
      [ivan, stefan, niko, petar].map((id) =>
        SearchFilter.barber([id as BarberId]),
      ),
    );
  });

  it('offers nothing from an empty window', () => {
    expect(SearchFilterSystem.starters(offered([], []), NOW)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(
      offered([SearchWhenPreset.Today], [ivan, stefan] as BarberId[]),
    );
    expect(SearchFilterSystem.starters(input, NOW)).toEqual(
      SearchFilterSystem.starters(input, NOW),
    );
  });
});

describe('SearchFilterSystem.offersBeyond — whether a short group has more', () => {
  const [ivan, niko] = ['ivan', 'niko'] as BarberId[];
  const [cut, beard] = ['cut', 'beard'] as ServiceId[];
  const short = ServiceVariantId.of('short');
  const long = ServiceVariantId.of('long');
  const offered = {
    barberIds: [ivan, niko] as readonly BarberId[],
    serviceIds: [cut, beard] as readonly ServiceId[],
    variants: [
      ServiceVariantPick.of(cut as ServiceId, short),
      ServiceVariantPick.of(cut as ServiceId, long),
    ],
    bookingStatuses: [BookingStatus.Confirmed, BookingStatus.Cancelled],
    whenPresets: [SearchWhenPreset.Today],
    hasNote: true,
  };

  it('always has more of «Кога»: a day or a span can be picked', () => {
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.When, offered, [
        SearchFilterSystem.whenOf(SearchWhenPreset.Today, NOW),
      ]),
    ).toBe(true);
  });

  it('has more barbers only while one is offered and not shown', () => {
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Barber, offered, [
        SearchFilter.barber([ivan as BarberId]),
      ]),
    ).toBe(true);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Barber, offered, [
        SearchFilter.barber([ivan as BarberId]),
        SearchFilter.barber([niko as BarberId]),
      ]),
    ).toBe(false);
  });

  it('counts a service and each of its variants', () => {
    const shortCut = SearchFilter.service(
      [],
      [ServiceVariantPick.of(cut as ServiceId, short)],
    );
    const longCut = SearchFilter.service(
      [],
      [ServiceVariantPick.of(cut as ServiceId, long)],
    );
    const beardOnly = SearchFilter.service([beard as ServiceId], []);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Service, offered, [
        shortCut,
        beardOnly,
      ]),
    ).toBe(true);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Service, offered, [
        shortCut,
        longCut,
        beardOnly,
      ]),
    ).toBe(false);
  });

  it('has more statuses, or the note, only while one is not shown', () => {
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Status, offered, [
        SearchFilter.bookingStatuses([BookingStatus.Confirmed]),
      ]),
    ).toBe(true);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Note, offered, [
        SearchFilter.note(),
      ]),
    ).toBe(false);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Note, offered, []),
    ).toBe(true);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(offered);
    const shown = deepFreeze([SearchFilter.barber([ivan as BarberId])]);
    expect(
      SearchFilterSystem.offersBeyond(SearchFilterField.Barber, input, shown),
    ).toBe(
      SearchFilterSystem.offersBeyond(SearchFilterField.Barber, input, shown),
    );
  });
});

describe('SearchFilterSystem.presetOf — which preset a span is, today', () => {
  it('names the span a preset built, on the shop’s own today', () => {
    for (const preset of Object.values(SearchWhenPreset)) {
      expect(
        SearchFilterSystem.presetOf(
          SearchFilterSystem.whenOf(preset, NOW),
          NOW,
        ),
      ).toBe(preset);
    }
  });

  it('is nothing for another span, or for a preset built on another day', () => {
    const twoDaysAgo = LocalDate.addDays(NOW.localDate, -2);
    expect(
      SearchFilterSystem.presetOf(
        SearchFilter.when(twoDaysAgo, twoDaysAgo),
        NOW,
      ),
    ).toBeNull();
    // «Днес» saved two days ago is no preset now (yesterday's would be «Вчера»).
    const lastWeek: ShopNow = { ...NOW, localDate: twoDaysAgo };
    const stale = SearchFilterSystem.whenOf(SearchWhenPreset.Today, lastWeek);
    expect(SearchFilterSystem.presetOf(stale, NOW)).toBeNull();
  });
});
