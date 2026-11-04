import {
  BarberId,
  BookingStatus,
  LocalDate,
  Result,
  ServiceId,
  Tag,
} from '@core/primitives';
import { SearchQueryError } from '@core/errors';
import { SearchFilter, SearchFilterField } from './search-filter.data';

/**
 * A schedule search as data: the text as typed and the filters chosen. A
 * recent search is one of these (saved on the device, read back through
 * {@link SearchQuery.parse}). The phone reading of the text is derived from
 * it (`SearchQuerySystem.read`), never stored.
 */
export type SearchQuery = {
  readonly searchText: string;
  readonly searchFilters: readonly SearchFilter[];
};

/** The order filters are kept in: one per kind, always this order. */
const KIND_ORDER: readonly SearchFilterField[] = [
  SearchFilterField.Barber,
  SearchFilterField.Service,
  SearchFilterField.Status,
  SearchFilterField.When,
  SearchFilterField.Note,
];

function inKindOrder(
  filters: readonly SearchFilter[],
): readonly SearchFilter[] {
  return [...filters].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.searchFilterField) -
      KIND_ORDER.indexOf(b.searchFilterField),
  );
}

function sorted(values: readonly string[]): string {
  return [...values].sort().join(',');
}

function keyOfFilter(filter: SearchFilter): string {
  switch (filter.searchFilterField) {
    case SearchFilterField.Barber:
      return `B:${sorted(filter.filterBarberIds)}`;
    case SearchFilterField.Service:
      return `S:${sorted(filter.filterServiceIds)}`;
    case SearchFilterField.Status:
      return `T:${sorted(filter.filterBookingStatuses)}`;
    case SearchFilterField.When:
      return `W:${filter.filterFromDate}..${filter.filterToDate}`;
    case SearchFilterField.Note:
      return 'N';
  }
}

function keyOf(query: SearchQuery): string {
  return `${query.searchText.trim()}|${inKindOrder(query.searchFilters)
    .map(keyOfFilter)
    .join(';')}`;
}

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** A non-empty array of well-formed ids, or the path of the first bad one. */
function idsOf<T>(
  raw: unknown,
  path: string,
  parse: (id: string) => Result<T, unknown>,
): Result<readonly T[], SearchQueryError> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return Result.err(SearchQueryError.invalid(path));
  }
  const out: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id: unknown = raw[i];
    const parsed = typeof id === 'string' ? parse(id) : null;
    if (parsed === null || !parsed.ok) {
      return Result.err(SearchQueryError.invalid(`${path}[${i}]`));
    }
    out.push(parsed.value);
  }
  return Result.ok(out);
}

function filterOf(
  raw: unknown,
  path: string,
): Result<SearchFilter, SearchQueryError> {
  if (!isRecord(raw)) return Result.err(SearchQueryError.invalid(path));
  const field = raw['searchFilterField'];
  if (field === SearchFilterField.Barber) {
    const ids = idsOf(raw['filterBarberIds'], `${path}.filterBarberIds`, (id) =>
      BarberId.parse(id),
    );
    return ids.ok ? Result.ok(SearchFilter.barber(ids.value)) : ids;
  }
  if (field === SearchFilterField.Service) {
    const ids = idsOf(
      raw['filterServiceIds'],
      `${path}.filterServiceIds`,
      (id) => ServiceId.parse(id),
    );
    return ids.ok ? Result.ok(SearchFilter.service(ids.value)) : ids;
  }
  if (field === SearchFilterField.Status) {
    const statuses = raw['filterBookingStatuses'];
    const at = `${path}.filterBookingStatuses`;
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return Result.err(SearchQueryError.invalid(at));
    }
    const out: BookingStatus[] = [];
    for (let i = 0; i < statuses.length; i++) {
      const status: unknown = statuses[i];
      if (!Tag.has(BookingStatus, status)) {
        return Result.err(SearchQueryError.invalid(`${at}[${i}]`));
      }
      out.push(status);
    }
    return Result.ok(SearchFilter.bookingStatuses(out));
  }
  if (field === SearchFilterField.When) {
    const rawFrom = raw['filterFromDate'];
    const rawTo = raw['filterToDate'];
    const from = typeof rawFrom === 'string' ? LocalDate.parse(rawFrom) : null;
    const to = typeof rawTo === 'string' ? LocalDate.parse(rawTo) : null;
    if (from === null || !from.ok) {
      return Result.err(SearchQueryError.invalid(`${path}.filterFromDate`));
    }
    if (to === null || !to.ok) {
      return Result.err(SearchQueryError.invalid(`${path}.filterToDate`));
    }
    return LocalDate.compare(from.value, to.value) > 0
      ? Result.err(SearchQueryError.invalid(`${path}.filterToDate`))
      : Result.ok(SearchFilter.when(from.value, to.value));
  }
  if (field === SearchFilterField.Note) {
    return raw['filterHasNote'] === true
      ? Result.ok(SearchFilter.note())
      : Result.err(SearchQueryError.invalid(`${path}.filterHasNote`));
  }
  return Result.err(SearchQueryError.invalid(`${path}.searchFilterField`));
}

export const SearchQuery = {
  /** Nothing typed, nothing chosen. */
  empty(): SearchQuery {
    return { searchText: '', searchFilters: [] };
  },

  /** No text (blanks aside) and no filter — the idle sheet. */
  isEmpty(query: SearchQuery): boolean {
    return (
      query.searchText.trim().length === 0 && query.searchFilters.length === 0
    );
  },

  withText(query: SearchQuery, searchText: string): SearchQuery {
    return { searchText, searchFilters: query.searchFilters };
  },

  /** The filter added: one of a kind is kept, so a second barber joins the first. */
  withFilter(query: SearchQuery, filter: SearchFilter): SearchQuery {
    let merged = false;
    const filters: SearchFilter[] = [];
    for (let i = 0; i < query.searchFilters.length; i++) {
      const held = query.searchFilters[i] as SearchFilter;
      if (held.searchFilterField === filter.searchFilterField) {
        filters.push(SearchFilter.merge(held, filter));
        merged = true;
      } else {
        filters.push(held);
      }
    }
    if (!merged) filters.push(filter);
    return {
      searchText: query.searchText,
      searchFilters: inKindOrder(filters),
    };
  },

  /** Every filter of a kind taken off. */
  withoutFilter(query: SearchQuery, field: SearchFilterField): SearchQuery {
    return {
      searchText: query.searchText,
      searchFilters: query.searchFilters.filter(
        (held) => held.searchFilterField !== field,
      ),
    };
  },

  /**
   * The values of `removed` taken off the filter of its kind: the ids it
   * names leave a list kind (the filter goes with its last id), a date span
   * or the note flag goes whole.
   */
  withoutFilterValue(query: SearchQuery, removed: SearchFilter): SearchQuery {
    const filters: SearchFilter[] = [];
    for (let i = 0; i < query.searchFilters.length; i++) {
      const held = query.searchFilters[i] as SearchFilter;
      const left = SearchFilter.subtract(held, removed);
      if (left !== null) filters.push(left);
    }
    return { searchText: query.searchText, searchFilters: filters };
  },

  /** The same search: text compared trimmed, filters by kind and value, not order. */
  equals(a: SearchQuery, b: SearchQuery): boolean {
    return keyOf(a) === keyOf(b);
  },

  /**
   * The edge guard of a stored search: a value read back from `localStorage`
   * (or anywhere untrusted) is a query, or the path of its first bad part.
   * Filters are read into one per kind, in order.
   */
  parse(raw: unknown): Result<SearchQuery, SearchQueryError> {
    if (!isRecord(raw)) return Result.err(SearchQueryError.invalid('$'));
    const text = raw['searchText'];
    if (typeof text !== 'string') {
      return Result.err(SearchQueryError.invalid('searchText'));
    }
    const held = raw['searchFilters'];
    if (!Array.isArray(held)) {
      return Result.err(SearchQueryError.invalid('searchFilters'));
    }
    let query: SearchQuery = { searchText: text, searchFilters: [] };
    for (let i = 0; i < held.length; i++) {
      const filter = filterOf(held[i], `searchFilters[${i}]`);
      if (!filter.ok) return filter;
      query = SearchQuery.withFilter(query, filter.value);
    }
    return Result.ok(query);
  },
} as const;
