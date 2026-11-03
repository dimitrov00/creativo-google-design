import type {
  BarberId,
  BookingStatus,
  LocalDate,
  ServiceId,
} from '@core/primitives';

/**
 * Which kind a schedule-search filter is — the discriminator
 * `searchFilterField`, the ONLY source of these strings. Filters of
 * different kinds combine with AND; the values inside one filter with OR.
 */
export const SearchFilterField = {
  Barber: 'BARBER',
  Service: 'SERVICE',
  Status: 'STATUS',
  When: 'WHEN',
  Note: 'NOTE',
} as const;
export type SearchFilterField =
  (typeof SearchFilterField)[keyof typeof SearchFilterField];

/** A narrowing of the schedule search: a flat union of variant slices. */
export type SearchFilter =
  | SearchFilter.Barber
  | SearchFilter.Service
  | SearchFilter.Status
  | SearchFilter.When
  | SearchFilter.Note;

function union<T>(a: readonly T[], b: readonly T[]): readonly T[] {
  const out: T[] = [...a];
  for (let i = 0; i < b.length; i++) {
    const value = b[i] as T;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function without<T>(a: readonly T[], b: readonly T[]): readonly T[] {
  const out: T[] = [];
  for (let i = 0; i < a.length; i++) {
    const value = a[i] as T;
    if (!b.includes(value)) out.push(value);
  }
  return out;
}

export const SearchFilter = {
  barber(filterBarberIds: readonly BarberId[]): SearchFilter.Barber {
    return { searchFilterField: SearchFilterField.Barber, filterBarberIds };
  },
  service(filterServiceIds: readonly ServiceId[]): SearchFilter.Service {
    return { searchFilterField: SearchFilterField.Service, filterServiceIds };
  },
  bookingStatuses(
    filterBookingStatuses: readonly BookingStatus[],
  ): SearchFilter.Status {
    return {
      searchFilterField: SearchFilterField.Status,
      filterBookingStatuses,
    };
  },
  /** An inclusive span of shop days. */
  when(filterFromDate: LocalDate, filterToDate: LocalDate): SearchFilter.When {
    return {
      searchFilterField: SearchFilterField.When,
      filterFromDate,
      filterToDate,
    };
  },
  note(): SearchFilter.Note {
    return { searchFilterField: SearchFilterField.Note, filterHasNote: true };
  },

  /**
   * `next` added to `current`, both of one kind: the ids of a list kind are
   * united (first seen first), a date span or the note flag is replaced.
   * Two filters of different kinds are not merged — `next` is answered.
   */
  merge(current: SearchFilter, next: SearchFilter): SearchFilter {
    if (
      current.searchFilterField === SearchFilterField.Barber &&
      next.searchFilterField === SearchFilterField.Barber
    ) {
      return SearchFilter.barber(
        union(current.filterBarberIds, next.filterBarberIds),
      );
    }
    if (
      current.searchFilterField === SearchFilterField.Service &&
      next.searchFilterField === SearchFilterField.Service
    ) {
      return SearchFilter.service(
        union(current.filterServiceIds, next.filterServiceIds),
      );
    }
    if (
      current.searchFilterField === SearchFilterField.Status &&
      next.searchFilterField === SearchFilterField.Status
    ) {
      return SearchFilter.bookingStatuses(
        union(current.filterBookingStatuses, next.filterBookingStatuses),
      );
    }
    return next;
  },

  /**
   * `current` without `removed`'s values, both of one kind: a list kind
   * loses those ids (`null` when none are left), a date span or the note flag
   * is removed whole (`null`). A filter of another kind is left as it is.
   */
  subtract(current: SearchFilter, removed: SearchFilter): SearchFilter | null {
    if (current.searchFilterField !== removed.searchFilterField) return current;
    if (
      current.searchFilterField === SearchFilterField.Barber &&
      removed.searchFilterField === SearchFilterField.Barber
    ) {
      const left = without(current.filterBarberIds, removed.filterBarberIds);
      return left.length === 0 ? null : SearchFilter.barber(left);
    }
    if (
      current.searchFilterField === SearchFilterField.Service &&
      removed.searchFilterField === SearchFilterField.Service
    ) {
      const left = without(current.filterServiceIds, removed.filterServiceIds);
      return left.length === 0 ? null : SearchFilter.service(left);
    }
    if (
      current.searchFilterField === SearchFilterField.Status &&
      removed.searchFilterField === SearchFilterField.Status
    ) {
      const left = without(
        current.filterBookingStatuses,
        removed.filterBookingStatuses,
      );
      return left.length === 0 ? null : SearchFilter.bookingStatuses(left);
    }
    return null;
  },
} as const;

/** ONE type-only namespace; each variant declared exactly once. */
export namespace SearchFilter {
  export type Barber = {
    readonly searchFilterField: typeof SearchFilterField.Barber;
    readonly filterBarberIds: readonly BarberId[];
  };
  export type Service = {
    readonly searchFilterField: typeof SearchFilterField.Service;
    readonly filterServiceIds: readonly ServiceId[];
  };
  export type Status = {
    readonly searchFilterField: typeof SearchFilterField.Status;
    readonly filterBookingStatuses: readonly BookingStatus[];
  };
  export type When = {
    readonly searchFilterField: typeof SearchFilterField.When;
    readonly filterFromDate: LocalDate;
    readonly filterToDate: LocalDate;
  };
  export type Note = {
    readonly searchFilterField: typeof SearchFilterField.Note;
    readonly filterHasNote: true;
  };
}
