/**
 * Compile-only proofs over the schedule-search query (Law 6.3): the filter
 * union is never `never`, every variant is flat, and `searchFilterField` narrows to exactly its variant's
 * fields. `tsc` failing IS the test; nothing here runs.
 */
import type { AllTrue, NoNested } from '@core/testing';
import { SearchFilter, SearchFilterField } from './search-filter.data';
import type { SearchQuery } from './search-query.data';

type IsNever<T> = [T] extends [never] ? true : false;
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

export const filterNotNever: IsNever<SearchFilter> = false;
export const queryNotNever: IsNever<SearchQuery> = false;
export const variantsFlat: EveryVariantFlat<SearchFilter> = true;
declare const filter: SearchFilter;
if (filter.searchFilterField === SearchFilterField.Barber) {
  void filter.filterBarberIds;
  // @ts-expect-error — a barber filter holds no services
  void filter.filterServiceIds;
}
if (filter.searchFilterField === SearchFilterField.When) {
  void filter.filterFromDate;
  void filter.filterToDate;
  // @ts-expect-error — a date span holds no barbers
  void filter.filterBarberIds;
}
if (filter.searchFilterField === SearchFilterField.Note) {
  const flag: true = filter.filterHasNote;
  void flag;
}
void SearchFilter;
