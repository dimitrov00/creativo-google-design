import type {
  BarberId,
  BookingStatus,
  LocalDate,
  ServiceId,
} from '@core/primitives';
import { ServiceVariantPick } from './service-variant-pick.data';

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

/** The picks of `a` and `b`, by key (first seen first). */
function unionPicks(
  a: readonly ServiceVariantPick[],
  b: readonly ServiceVariantPick[],
): readonly ServiceVariantPick[] {
  const out: ServiceVariantPick[] = [...a];
  const keys = a.map(ServiceVariantPick.keyOf);
  for (let i = 0; i < b.length; i++) {
    const pick = b[i] as ServiceVariantPick;
    const key = ServiceVariantPick.keyOf(pick);
    if (!keys.includes(key)) {
      out.push(pick);
      keys.push(key);
    }
  }
  return out;
}

/** The picks of `a` not in `b`, by key. */
function withoutPicks(
  a: readonly ServiceVariantPick[],
  b: readonly ServiceVariantPick[],
): readonly ServiceVariantPick[] {
  const gone = b.map(ServiceVariantPick.keyOf);
  return a.filter((pick) => !gone.includes(ServiceVariantPick.keyOf(pick)));
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
  /**
   * Services, whole, and service VARIANTS (a variant of a service is picked
   * on its own — «Подстрижка с ножица · Дълга»): a visit matches when one of
   * its seats is one of the services, or one of the variants of its service.
   */
  service(
    filterServiceIds: readonly ServiceId[],
    filterVariants: readonly ServiceVariantPick[],
  ): SearchFilter.Service {
    return {
      searchFilterField: SearchFilterField.Service,
      filterServiceIds,
      filterVariants,
    };
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
   * Does a kind hold SEVERAL values (barbers, services, statuses — matched
   * with OR), rather than one span or one flag? A many-valued kind is picked
   * as a set and applied once; a single-valued one by one tap.
   */
  holdsMany(field: SearchFilterField): boolean {
    return (
      field === SearchFilterField.Barber ||
      field === SearchFilterField.Service ||
      field === SearchFilterField.Status
    );
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
        unionPicks(current.filterVariants, next.filterVariants),
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
      const services = without(
        current.filterServiceIds,
        removed.filterServiceIds,
      );
      const variants = withoutPicks(
        current.filterVariants,
        removed.filterVariants,
      );
      return services.length === 0 && variants.length === 0
        ? null
        : SearchFilter.service(services, variants);
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
    readonly filterVariants: readonly ServiceVariantPick[];
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
