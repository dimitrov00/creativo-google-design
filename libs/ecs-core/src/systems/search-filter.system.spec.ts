import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  SearchFilter,
  SearchFilterField,
  SearchWhenPreset,
  type ShopNow,
} from '@core/components';
import {
  type BarberId,
  BookingStatus,
  LocalDate,
  type ServiceId,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_NOW,
  FIXTURE_TODAY,
  SEARCH_BARBERS,
  SEARCH_SERVICES,
  deepFreeze,
  searchWindowFixture,
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
          return visit.seats.some((seat) =>
            filter.filterServiceIds.includes(seat.serviceId),
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
      SearchFilter.service([SEARCH_SERVICES[1]!.id]),
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
          SearchFilter.service([id as ServiceId]),
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
        SearchWhenPreset.ThisWeek,
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

describe('SearchFilterSystem.presetOf — which preset a span is, today', () => {
  it('names the span a preset built, on the shop’s own today', () => {
    for (const preset of [
      SearchWhenPreset.Today,
      SearchWhenPreset.Tomorrow,
      SearchWhenPreset.ThisWeek,
    ]) {
      expect(
        SearchFilterSystem.presetOf(
          SearchFilterSystem.whenOf(preset, NOW),
          NOW,
        ),
      ).toBe(preset);
    }
  });

  it('is nothing for another span, or for a preset built on another day', () => {
    const yesterday = LocalDate.addDays(NOW.localDate, -1);
    expect(
      SearchFilterSystem.presetOf(SearchFilter.when(yesterday, yesterday), NOW),
    ).toBeNull();
    const lastWeek: ShopNow = { ...NOW, localDate: yesterday };
    const stale = SearchFilterSystem.whenOf(SearchWhenPreset.Today, lastWeek);
    expect(SearchFilterSystem.presetOf(stale, NOW)).toBeNull();
  });
});
