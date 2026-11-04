import type { SearchFilter, SearchQuery } from '@core/components';
import type { UiIconName } from '@creativo/ui/controls';
import type { VisitSectionVm } from '@creativo/features/shared/visits';

/*
 * THE SEARCH SHEET'S DISPLAY MODEL (Law 10.3): types only. The sheet is one
 * of three states; the chips, the recents, the suggestions and the result
 * groups are plain structs. A chip, a suggestion or a recent carries the
 * DATA its press acts on (`filter`, `query`) so the sheet never parses a
 * label or an id. `staff-search.presenter.ts` fills it.
 */

/** What the sheet shows — the field `searchSheetState`. */
export const SearchSheetState = {
  /** Nothing typed and no chip: the recents and the suggestions. */
  Idle: 'IDLE',
  /** At least one visit matches: the result groups. */
  Results: 'RESULTS',
  /** A search that matches nothing. */
  Empty: 'EMPTY',
} as const;
export type SearchSheetState =
  (typeof SearchSheetState)[keyof typeof SearchSheetState];

/** Which kind of suggestions a group holds — the field `suggestionGroupKind`. */
export const SuggestionGroupKind = {
  When: 'WHEN',
  Status: 'STATUS',
  Note: 'NOTE',
  Barber: 'BARBER',
  Service: 'SERVICE',
} as const;
export type SuggestionGroupKind =
  (typeof SuggestionGroupKind)[keyof typeof SuggestionGroupKind];

/** A filter chip in the field: one value of one filter. */
export interface ChipVm {
  readonly id: string;
  readonly label: string;
  /** What pressing it does: «Махни филтъра Николай». */
  readonly removeLabel: string;
  /** The single value this chip stands for — what `withoutFilterValue` takes off. */
  readonly filter: SearchFilter;
}

/** A filter on offer; pressing it adds it. */
export interface SuggestionVm {
  readonly id: string;
  readonly label: string;
  readonly filter: SearchFilter;
}

export interface SuggestionGroupVm {
  readonly suggestionGroupKind: SuggestionGroupKind;
  /** «Бръснар», «Услуга»; null for the groups that need none. */
  readonly heading: string | null;
  readonly suggestions: readonly SuggestionVm[];
}

/** A recent search; pressing it runs it again. */
export interface RecentVm {
  readonly id: string;
  readonly label: string;
  readonly query: SearchQuery;
}

/** The sheet, worded. */
export interface SearchSheetVm {
  readonly searchSheetState: SearchSheetState;
  /** The field's leading glyph: what the text was taken for. */
  readonly glyph: UiIconName;
  readonly chips: readonly ChipVm[];
  readonly recents: readonly RecentVm[];
  readonly suggestions: readonly SuggestionGroupVm[];
  /** «Телефон +359 88 333…» — only when the text reads as a number. */
  readonly phoneRow: string | null;
  /** The result groups: a heading and its event cards. */
  readonly groups: readonly VisitSectionVm[];
  /** «Махни филтрите» on an empty result with chips; else null. */
  readonly clearFilters: string | null;
  /** The quiet notes under the sheet: capped, out of date, more than shown. */
  readonly footnotes: readonly string[];
}
