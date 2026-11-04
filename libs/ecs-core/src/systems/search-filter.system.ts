import {
  PhoneReadingKind,
  SearchFilter,
  SearchFilterField,
  SearchWhenPreset,
  type ShopNow,
} from '@core/components';
import {
  type BarberId,
  type BookingStatus,
  LocalDate,
  type ServiceId,
} from '@core/primitives';
import { PhoneSystem } from './phone.system';
import type { ReadQuery } from './search-query.system';
import type { SearchIndex } from './search-index.system';

/**
 * What the search can still be narrowed by: the distinct values present in
 * the visits the typed text matches, each kind computed with that kind's OWN
 * filter taken off (a chosen barber does not hide the other barbers) and
 * every OTHER filter still applied — so each value offered keeps at least one
 * visit. First-seen order, ascending by window position.
 */
export type SearchSuggestions = {
  readonly barberIds: readonly BarberId[];
  readonly serviceIds: readonly ServiceId[];
  readonly bookingStatuses: readonly BookingStatus[];
  readonly whenPresets: readonly SearchWhenPreset[];
  /** Some matching visit has a note. */
  readonly hasNote: boolean;
};

const PRESET_ORDER: readonly SearchWhenPreset[] = [
  SearchWhenPreset.Today,
  SearchWhenPreset.Tomorrow,
  SearchWhenPreset.ThisWeek,
];

/** The filters of a query, one slot per kind — `null` for a kind not chosen. */
type Chosen = {
  readonly barberIds: readonly BarberId[] | null;
  readonly serviceIds: readonly ServiceId[] | null;
  readonly bookingStatuses: readonly BookingStatus[] | null;
  readonly fromDate: LocalDate | null;
  readonly toDate: LocalDate | null;
  readonly hasNote: boolean;
};

function chosenOf(filters: readonly SearchFilter[]): Chosen {
  let barberIds: readonly BarberId[] | null = null;
  let serviceIds: readonly ServiceId[] | null = null;
  let bookingStatuses: readonly BookingStatus[] | null = null;
  let fromDate: LocalDate | null = null;
  let toDate: LocalDate | null = null;
  let hasNote = false;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i] as SearchFilter;
    switch (filter.searchFilterField) {
      case SearchFilterField.Barber:
        barberIds = filter.filterBarberIds;
        break;
      case SearchFilterField.Service:
        serviceIds = filter.filterServiceIds;
        break;
      case SearchFilterField.Status:
        bookingStatuses = filter.filterBookingStatuses;
        break;
      case SearchFilterField.When:
        fromDate = filter.filterFromDate;
        toDate = filter.filterToDate;
        break;
      case SearchFilterField.Note:
        hasNote = filter.filterHasNote;
        break;
    }
  }
  return { barberIds, serviceIds, bookingStatuses, fromDate, toDate, hasNote };
}

/** One bit per kind, set when a visit FAILS that kind's filter. */
const FAILS_BARBER = 1;
const FAILS_SERVICE = 2;
const FAILS_STATUS = 4;
const FAILS_WHEN = 8;
const FAILS_NOTE = 16;

function anyIn<T>(held: readonly T[], wanted: readonly T[]): boolean {
  for (let i = 0; i < held.length; i++) {
    if (wanted.includes(held[i] as T)) return true;
  }
  return false;
}

/** Does the visit hold every text term (in any field) and the number? */
function textMatches(index: SearchIndex, read: ReadQuery, at: number): boolean {
  const terms = read.queryTerms;
  for (let t = 0; t < terms.length; t++) {
    const term = terms[t] as string;
    if (
      !(index.clientText[at] as string).includes(term) &&
      !(index.serviceText[at] as string).includes(term) &&
      !(index.barberText[at] as string).includes(term) &&
      !(index.emailText[at] as string).includes(term) &&
      !(index.noteText[at] as string).includes(term)
    ) {
      return false;
    }
  }
  return (
    read.queryPhone.phoneReadingKind === PhoneReadingKind.None ||
    PhoneSystem.readingMatches(read.queryPhone, index.phoneDigits[at] as string)
  );
}

/** The kinds of filter the visit at `at` fails, as a bit set. */
function failsOf(index: SearchIndex, chosen: Chosen, at: number): number {
  let fails = 0;
  if (
    chosen.barberIds !== null &&
    !anyIn(index.barberIds[at] as readonly BarberId[], chosen.barberIds)
  ) {
    fails |= FAILS_BARBER;
  }
  if (
    chosen.serviceIds !== null &&
    !anyIn(index.serviceIds[at] as readonly ServiceId[], chosen.serviceIds)
  ) {
    fails |= FAILS_SERVICE;
  }
  if (
    chosen.bookingStatuses !== null &&
    !chosen.bookingStatuses.includes(index.bookingStatus[at] as BookingStatus)
  ) {
    fails |= FAILS_STATUS;
  }
  if (chosen.fromDate !== null && chosen.toDate !== null) {
    const day = index.localDate[at] as LocalDate;
    if (day < chosen.fromDate || day > chosen.toDate) fails |= FAILS_WHEN;
  }
  if (chosen.hasNote && !index.hasNote[at]) fails |= FAILS_NOTE;
  return fails;
}

function pushOnce<T>(into: T[], value: T): void {
  if (!into.includes(value)) into.push(value);
}

/**
 * SearchFilterSystem — which visits of the folded window a search keeps, and
 * what it could still be narrowed by. Linear scans over the index's columns;
 * nothing is folded or allocated per visit (the index folded once).
 */
export const SearchFilterSystem = {
  /**
   * The most result cards the sheet draws: a card is a rich row, and a filter
   * alone ("Confirmed") can match thousands. The list is ordered outward from
   * now, so the visits left off are the farthest.
   */
  RESULT_LIMIT: 200,

  /**
   * The window positions that satisfy the typed text (every term, in any
   * field; the number against the phone), then every filter — ascending, in
   * one pass. An empty query keeps every visit.
   */
  keep(
    index: SearchIndex,
    read: ReadQuery,
    filters: readonly SearchFilter[],
  ): readonly number[] {
    const chosen = chosenOf(filters);
    const kept: number[] = [];
    for (let at = 0; at < index.visitCount; at++) {
      if (textMatches(index, read, at) && failsOf(index, chosen, at) === 0) {
        kept.push(at);
      }
    }
    return kept;
  },

  /**
   * The distinct values the matching visits offer to narrow by, each kind
   * with its own filter off (see {@link SearchSuggestions}). Date presets are
   * read against the shop's `shopNow`. One pass: a visit counts toward a kind
   * when it fails no filter but that kind's own.
   */
  suggestions(
    index: SearchIndex,
    read: ReadQuery,
    filters: readonly SearchFilter[],
    shopNow: ShopNow,
  ): SearchSuggestions {
    const chosen = chosenOf(filters);
    const spans = PRESET_ORDER.map((preset) => {
      const when = SearchFilterSystem.whenOf(preset, shopNow);
      return { preset, from: when.filterFromDate, to: when.filterToDate };
    });
    const barberIds: BarberId[] = [];
    const serviceIds: ServiceId[] = [];
    const bookingStatuses: BookingStatus[] = [];
    const reached = new Set<SearchWhenPreset>();
    let hasNote = false;
    for (let at = 0; at < index.visitCount; at++) {
      if (!textMatches(index, read, at)) continue;
      const fails = failsOf(index, chosen, at);
      if ((fails & ~FAILS_BARBER) === 0) {
        const held = index.barberIds[at] as readonly BarberId[];
        for (let b = 0; b < held.length; b++)
          pushOnce(barberIds, held[b] as BarberId);
      }
      if ((fails & ~FAILS_SERVICE) === 0) {
        const held = index.serviceIds[at] as readonly ServiceId[];
        for (let s = 0; s < held.length; s++)
          pushOnce(serviceIds, held[s] as ServiceId);
      }
      if ((fails & ~FAILS_STATUS) === 0) {
        pushOnce(bookingStatuses, index.bookingStatus[at] as BookingStatus);
      }
      if ((fails & ~FAILS_WHEN) === 0) {
        const day = index.localDate[at] as LocalDate;
        for (let p = 0; p < spans.length; p++) {
          const span = spans[p] as (typeof spans)[number];
          if (day >= span.from && day <= span.to) reached.add(span.preset);
        }
      }
      if ((fails & ~FAILS_NOTE) === 0 && index.hasNote[at]) hasNote = true;
    }
    return {
      barberIds,
      serviceIds,
      bookingStatuses,
      whenPresets: PRESET_ORDER.filter((preset) => reached.has(preset)),
      hasNote,
    };
  },

  /**
   * Which preset a date filter IS on the shop's own today — the span a preset
   * built — or `null` for any other span (a recent saved last week). The
   * chip says «Днес» only while it is today.
   */
  presetOf(
    filter: SearchFilter.When,
    shopNow: ShopNow,
  ): SearchWhenPreset | null {
    for (let i = 0; i < PRESET_ORDER.length; i++) {
      const preset = PRESET_ORDER[i] as SearchWhenPreset;
      const built = SearchFilterSystem.whenOf(preset, shopNow);
      if (
        built.filterFromDate === filter.filterFromDate &&
        built.filterToDate === filter.filterToDate
      ) {
        return preset;
      }
    }
    return null;
  },

  /**
   * The date filter of a preset, from the shop's own today (Law 7):
   * `TODAY`, `TOMORROW`, and `THIS_WEEK` — today through the next six days.
   */
  whenOf(preset: SearchWhenPreset, shopNow: ShopNow): SearchFilter.When {
    const today = shopNow.localDate;
    switch (preset) {
      case SearchWhenPreset.Today:
        return SearchFilter.when(today, today);
      case SearchWhenPreset.Tomorrow: {
        const tomorrow = LocalDate.addDays(today, 1);
        return SearchFilter.when(tomorrow, tomorrow);
      }
      case SearchWhenPreset.ThisWeek:
        return SearchFilter.when(today, LocalDate.addDays(today, 6));
    }
  },
} as const;
