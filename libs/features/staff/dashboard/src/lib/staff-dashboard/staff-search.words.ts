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
  readonly today: string;
  readonly tomorrow: string;
  readonly yesterday: string;
  readonly thisWeek: string;
  readonly pastWeek: string;
  readonly earlier: string;
  /** The keys a filter is made of: «Кога», «Бръснар», «Услуга», «Статус», «Бележка». */
  readonly whenKey: string;
  readonly barberKey: string;
  readonly serviceKey: string;
  readonly statusKey: string;
  readonly noteKey: string;
  /** The note filter's value beside its key, and alone: «има» · «С бележка». */
  readonly hasNote: string;
  readonly withNote: string;
  readonly pickDay: string;
  readonly pickRange: string;
  readonly removeFilter: string;
  /** «Приложи» — the bar's primary for a set being picked, with nothing ticked. */
  readonly apply: string;
  /** «Приложи (2)». */
  readonly applyCount: (count: number) => string;
  readonly pickDayCaption: string;
  readonly rangeFirstCaption: string;
  /** «От 5 ноем. · избери последния ден» — `{{from}}` is already formatted. */
  readonly rangeLastCaption: (from: string) => string;
  readonly placeholder: string;
  /** The placeholder with filters chosen: «Търси…». */
  readonly placeholderShort: string;
  /** «Търси в „Бръснар“…» — the placeholder while a key's values are open. */
  readonly scopedPlaceholder: (key: string) => string;
  readonly empty: string;
  readonly clearFilters: string;
  readonly truncated: string;
  readonly stale: string;
  /** «Телефон +359 88 333» — `{{number}}` is already formatted. */
  readonly phoneRow: (number: string) => string;
  /** «Бръснар: Иван, Стефан. Промени филтъра». */
  readonly tokenLabel: (key: string, value: string) => string;
  /** «Бръснар: „ни“» — the open chip, with what is typed into it. */
  readonly chipTyped: (key: string, text: string) => string;
  /** «Бръснар: избери стойност» — a key still being picked. */
  readonly tokenBuilding: (key: string) => string;
  /** «+2» — the values a chip does not name. */
  readonly moreValues: (count: number) => string;
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
    today: translate('staff.search.today'),
    tomorrow: translate('staff.search.tomorrow'),
    yesterday: translate('staff.search.yesterday'),
    thisWeek: translate('staff.search.thisWeek'),
    pastWeek: translate('staff.search.pastWeek'),
    earlier: translate('staff.search.earlier'),
    whenKey: translate('staff.search.key.when'),
    barberKey: translate('staff.search.key.barber'),
    serviceKey: translate('staff.search.key.service'),
    statusKey: translate('staff.search.key.status'),
    noteKey: translate('staff.search.key.note'),
    hasNote: translate('staff.search.hasNote'),
    withNote: translate('staff.search.withNote'),
    pickDay: translate('staff.search.pickDay'),
    pickRange: translate('staff.search.pickRange'),
    removeFilter: translate('staff.search.removeFilter'),
    apply: translate('staff.search.apply'),
    applyCount: (count) => translate('staff.search.applyCount', { count }),
    pickDayCaption: translate('staff.search.pickDayCaption'),
    rangeFirstCaption: translate('staff.search.rangeFirstCaption'),
    rangeLastCaption: (from) =>
      translate('staff.search.rangeLastCaption', { from }),
    placeholder: translate('staff.day.searchPlaceholder'),
    placeholderShort: translate('staff.search.placeholderShort'),
    scopedPlaceholder: (key) =>
      translate('staff.search.scopedPlaceholder', { key }),
    empty: translate('staff.day.searchEmpty'),
    clearFilters: translate('staff.search.clearFilters'),
    truncated: translate('staff.day.searchTruncated'),
    stale: translate('staff.day.searchStale'),
    phoneRow: (number) => translate('staff.search.phoneRow', { number }),
    tokenLabel: (key, value) =>
      translate('staff.search.tokenLabel', { key, value }),
    tokenBuilding: (key) => translate('staff.search.tokenBuilding', { key }),
    chipTyped: (key, text) =>
      translate('staff.search.chipTyped', { key, text }),
    moreValues: (count) => translate('staff.search.moreValues', { count }),
    moreThanShown: (count) =>
      translate('staff.search.moreThanShown', { count }),
    statusWord: (status) =>
      translate(`staff.search.status.${STATUS_KEY[status]}`),
  };
}
