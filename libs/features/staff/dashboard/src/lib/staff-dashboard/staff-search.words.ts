import { BookingStatus } from '@core/primitives';
import type { StaffTranslate } from './staff-day.vm';

/*
 * THE SEARCH SHEET'S WORDS, read once from the catalogue (Law 10: wording
 * helpers are as pure as a presenter — the translator arrives as an argument).
 * Keys live under `staff.search.*` and `staff.day.search*`.
 */
export interface StaffSearchWords {
  readonly recents: string;
  readonly clearRecents: string;
  readonly suggestions: string;
  readonly today: string;
  readonly tomorrow: string;
  readonly thisWeek: string;
  readonly earlier: string;
  readonly withNote: string;
  readonly barberGroup: string;
  readonly serviceGroup: string;
  readonly empty: string;
  readonly clearFilters: string;
  readonly truncated: string;
  readonly stale: string;
  /** «Телефон +359 88 333» — `{{number}}` is already formatted. */
  readonly phoneRow: (number: string) => string;
  /** «Махни филтъра Николай». */
  readonly chipRemove: (label: string) => string;
  /** «Показани са първите 200 резултата» — `{{count}}`. */
  readonly moreThanShown: (count: number) => string;
  /** «Потвърдени» · «Отказани» · … — one word per stored status. */
  readonly statusWord: (status: BookingStatus) => string;
}

const STATUS_KEY: Readonly<Record<BookingStatus, string>> = {
  [BookingStatus.Pending]: 'pending',
  [BookingStatus.Confirmed]: 'confirmed',
  [BookingStatus.Completed]: 'completed',
  [BookingStatus.NoShow]: 'noShow',
  [BookingStatus.Cancelled]: 'cancelled',
};

export function staffSearchWordsOf(
  translate: StaffTranslate,
): StaffSearchWords {
  return {
    recents: translate('staff.search.recents'),
    clearRecents: translate('staff.search.clearRecents'),
    suggestions: translate('staff.search.suggestions'),
    today: translate('staff.search.today'),
    tomorrow: translate('staff.search.tomorrow'),
    thisWeek: translate('staff.search.thisWeek'),
    earlier: translate('staff.search.earlier'),
    withNote: translate('staff.search.withNote'),
    barberGroup: translate('staff.search.barberGroup'),
    serviceGroup: translate('staff.search.serviceGroup'),
    empty: translate('staff.day.searchEmpty'),
    clearFilters: translate('staff.search.clearFilters'),
    truncated: translate('staff.day.searchTruncated'),
    stale: translate('staff.day.searchStale'),
    phoneRow: (number) => translate('staff.search.phoneRow', { number }),
    chipRemove: (label) => translate('staff.search.chipRemove', { label }),
    moreThanShown: (count) =>
      translate('staff.search.moreThanShown', { count }),
    statusWord: (status) =>
      translate(`staff.search.status.${STATUS_KEY[status]}`),
  };
}
