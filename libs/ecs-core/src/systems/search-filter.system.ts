import {
  PhoneReadingKind,
  SearchFilter,
  SearchFilterField,
  SearchWhenPreset,
  ServiceVariantPick,
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
  /** The variants the matching visits were booked at, with their services — a service's own values, offered on their own. */
  readonly variants: readonly ServiceVariantPick[];
  readonly bookingStatuses: readonly BookingStatus[];
  readonly whenPresets: readonly SearchWhenPreset[];
  /** Some matching visit has a note. */
  readonly hasNote: boolean;
};

/** The order presets are offered in: the single days nearest first, then the weeks. */
const PRESET_ORDER: readonly SearchWhenPreset[] = [
  SearchWhenPreset.Today,
  SearchWhenPreset.Tomorrow,
  SearchWhenPreset.Yesterday,
  SearchWhenPreset.ThisWeek,
  SearchWhenPreset.PastWeek,
];

/** The filters of a query, one slot per kind — `null` for a kind not chosen. */
type Chosen = {
  readonly barberIds: readonly BarberId[] | null;
  readonly serviceIds: readonly ServiceId[] | null;
  readonly variantKeys: readonly string[];
  readonly bookingStatuses: readonly BookingStatus[] | null;
  readonly fromDate: LocalDate | null;
  readonly toDate: LocalDate | null;
  readonly hasNote: boolean;
};

function chosenOf(filters: readonly SearchFilter[]): Chosen {
  let barberIds: readonly BarberId[] | null = null;
  let serviceIds: readonly ServiceId[] | null = null;
  let variantKeys: readonly string[] = [];
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
        variantKeys = filter.filterVariants.map(ServiceVariantPick.keyOf);
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
  return {
    barberIds,
    serviceIds,
    variantKeys,
    bookingStatuses,
    fromDate,
    toDate,
    hasNote,
  };
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
  // A service filter is its services whole OR its variants: a visit passes
  // on either.
  if (
    chosen.serviceIds !== null &&
    !anyIn(index.serviceIds[at] as readonly ServiceId[], chosen.serviceIds) &&
    !anyIn(index.variantKeys[at] as readonly string[], chosen.variantKeys)
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
    const variants: ServiceVariantPick[] = [];
    const variantKeys: string[] = [];
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
        const picks = index.variants[at] as readonly ServiceVariantPick[];
        const keys = index.variantKeys[at] as readonly string[];
        for (let v = 0; v < picks.length; v++) {
          if (variantKeys.includes(keys[v] as string)) continue;
          variantKeys.push(keys[v] as string);
          variants.push(picks[v] as ServiceVariantPick);
        }
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
      variants,
      bookingStatuses,
      whenPresets: PRESET_ORDER.filter((preset) => reached.has(preset)),
      hasNote,
    };
  },

  /** The most filters an untouched search offers to start from. */
  STARTER_LIMIT: 5,

  /**
   * What an untouched search offers to start from (≙ Mail's «Suggestions»
   * before anything is typed): today and tomorrow while the window reaches
   * them, then the barbers with visits in it, in the order the window offers
   * them — at most {@link SearchFilterSystem.STARTER_LIMIT}. Each is a
   * single-value filter, ready to add.
   */
  starters(
    offered: SearchSuggestions,
    shopNow: ShopNow,
  ): readonly SearchFilter[] {
    const out: SearchFilter[] = [];
    const days = [SearchWhenPreset.Today, SearchWhenPreset.Tomorrow];
    for (let i = 0; i < days.length; i++) {
      const preset = days[i] as SearchWhenPreset;
      if (offered.whenPresets.includes(preset)) {
        out.push(SearchFilterSystem.whenOf(preset, shopNow));
      }
    }
    for (
      let b = 0;
      b < offered.barberIds.length &&
      out.length < SearchFilterSystem.STARTER_LIMIT;
      b++
    ) {
      out.push(SearchFilter.barber([offered.barberIds[b] as BarberId]));
    }
    return out;
  },

  /**
   * The offered services in the CATALOGUE's order (owner, 2026-11-06: the
   * search and the visit sheet's «Добави услуга» list a service in the
   * same place) — the order the bookings first named them in only breaks
   * ties for a service the catalogue no longer lists, which comes last.
   */
  inCatalogueOrder(
    serviceIds: readonly ServiceId[],
    catalogue: readonly ServiceId[],
  ): readonly ServiceId[] {
    const rank = new Map<ServiceId, number>();
    for (let i = 0; i < catalogue.length; i++) {
      rank.set(catalogue[i] as ServiceId, i);
    }
    const unlisted = catalogue.length;
    return serviceIds
      .map((id, at) => ({ id, at, rank: rank.get(id) ?? unlisted }))
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .map((entry) => entry.id);
  },

  /**
   * Whether a key offers a value the shown ones leave out — what decides
   * whether a short group of its values (the starters, the matches) points
   * on to the key's whole list. A day or a span can always be picked, so
   * «Кога» always offers more; the others offer more while a barber, a
   * service, a variant, a status or the note is offered and not shown.
   */
  offersBeyond(
    field: SearchFilterField,
    offered: SearchSuggestions,
    shown: readonly SearchFilter[],
  ): boolean {
    switch (field) {
      case SearchFilterField.When:
        return true;
      case SearchFilterField.Barber: {
        const seen = new Set<BarberId>();
        for (let i = 0; i < shown.length; i++) {
          const filter = shown[i] as SearchFilter;
          if (filter.searchFilterField === SearchFilterField.Barber) {
            for (const id of filter.filterBarberIds) seen.add(id);
          }
        }
        for (let i = 0; i < offered.barberIds.length; i++) {
          if (!seen.has(offered.barberIds[i] as BarberId)) return true;
        }
        return false;
      }
      case SearchFilterField.Service: {
        const services = new Set<ServiceId>();
        const picks = new Set<string>();
        for (let i = 0; i < shown.length; i++) {
          const filter = shown[i] as SearchFilter;
          if (filter.searchFilterField === SearchFilterField.Service) {
            for (const id of filter.filterServiceIds) services.add(id);
            for (const pick of filter.filterVariants) {
              services.add(pick.serviceId);
              picks.add(ServiceVariantPick.keyOf(pick));
            }
          }
        }
        for (let i = 0; i < offered.serviceIds.length; i++) {
          if (!services.has(offered.serviceIds[i] as ServiceId)) return true;
        }
        for (let i = 0; i < offered.variants.length; i++) {
          const pick = offered.variants[i] as ServiceVariantPick;
          if (!picks.has(ServiceVariantPick.keyOf(pick))) return true;
        }
        return false;
      }
      case SearchFilterField.Status: {
        const seen = new Set<BookingStatus>();
        for (let i = 0; i < shown.length; i++) {
          const filter = shown[i] as SearchFilter;
          if (filter.searchFilterField === SearchFilterField.Status) {
            for (const status of filter.filterBookingStatuses) seen.add(status);
          }
        }
        for (let i = 0; i < offered.bookingStatuses.length; i++) {
          if (!seen.has(offered.bookingStatuses[i] as BookingStatus))
            return true;
        }
        return false;
      }
      case SearchFilterField.Note:
        return (
          offered.hasNote &&
          !shown.some(
            (filter) => filter.searchFilterField === SearchFilterField.Note,
          )
        );
    }
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
   * `TODAY`, `TOMORROW`, `YESTERDAY`, `THIS_WEEK` — today through the next
   * six days — and `PAST_WEEK`, the six days before today through today.
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
      case SearchWhenPreset.Yesterday: {
        const yesterday = LocalDate.addDays(today, -1);
        return SearchFilter.when(yesterday, yesterday);
      }
      case SearchWhenPreset.ThisWeek:
        return SearchFilter.when(today, LocalDate.addDays(today, 6));
      case SearchWhenPreset.PastWeek:
        return SearchFilter.when(LocalDate.addDays(today, -6), today);
    }
  },

  /**
   * The span two picked days make, whichever was picked first: the earlier
   * day starts it. The same day twice is that one day.
   */
  spanOf(a: LocalDate, b: LocalDate): SearchFilter.When {
    return LocalDate.compare(a, b) <= 0
      ? SearchFilter.when(a, b)
      : SearchFilter.when(b, a);
  },
} as const;
