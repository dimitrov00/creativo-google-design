import type {
  SearchFilter,
  SearchFilterField,
  SearchQuery,
} from '@core/components';
import type { LocalDate } from '@core/primitives';
import type { UiIconName } from '@creativo/ui/controls';
import type { VisitSectionVm } from '@creativo/features/shared/visits';

/*
 * THE SEARCH SHEET'S DISPLAY MODEL (Law 10.3): types only. The sheet is one
 * of three states; the tokens, the recents, the dropdown and the result
 * groups are plain structs. A token, a dropdown row or a recent carries the
 * DATA its press acts on (`searchFilterField`, `filter`, `query`) so the
 * sheet never parses a label or an id. `staff-search.presenter.ts` fills it.
 */

/** What the sheet shows — the field `searchSheetState`. */
export const SearchSheetState = {
  /** Nothing typed and no token: the recents. */
  Idle: 'IDLE',
  /** At least one visit matches: the result groups. */
  Results: 'RESULTS',
  /** A search that matches nothing. */
  Empty: 'EMPTY',
} as const;
export type SearchSheetState =
  (typeof SearchSheetState)[keyof typeof SearchSheetState];

/** What the dropdown under the field lists — the field `dropdownMode`. */
export const DropdownMode = {
  /** Nothing typed, no key open: the keys a filter can be made of. */
  Fields: 'FIELDS',
  /** A key open (a token being built, or a token pressed): its values. */
  Values: 'VALUES',
  /** Text typed, no key open: the values and keys the text names, then the keys. */
  Matches: 'MATCHES',
} as const;
export type DropdownMode = (typeof DropdownMode)[keyof typeof DropdownMode];

/** What pressing a dropdown row does — the field `dropdownAction`. */
export const DropdownAction = {
  /** A key: open its values (a key with no values adds its filter instead). */
  OpenField: 'OPEN_FIELD',
  /** A value: add it, and close the key. */
  AddValue: 'ADD_VALUE',
  /** A value of a held filter: add or take it off, the key stays open. */
  ToggleValue: 'TOGGLE_VALUE',
  /** The held filter of the open key, taken off whole. */
  RemoveFilter: 'REMOVE_FILTER',
  /** «Конкретна дата…»: the month opens for one day. */
  PickDay: 'PICK_DAY',
  /** «Период…»: the month opens for two days. */
  PickRange: 'PICK_RANGE',
} as const;
export type DropdownAction =
  (typeof DropdownAction)[keyof typeof DropdownAction];

/** How the month in the dropdown is being picked — the field `calendarMode`. */
export const CalendarMode = {
  Day: 'DAY',
  Range: 'RANGE',
} as const;
export type CalendarMode = (typeof CalendarMode)[keyof typeof CalendarMode];

/** A face a token or a row leads with — a barber. */
export interface FaceVm {
  readonly src: string | null;
  readonly name: string;
}

/** A filter in the field: its key and its value, ≙ `UiSearchFieldToken`. */
export interface TokenVm {
  /** The kind it filters — one token per kind. */
  readonly id: SearchFilterField;
  /** «Бръснар». */
  readonly key: string;
  /** «Иван, Стефан +1»; '' while the token is still being built. */
  readonly value: string;
  readonly faces: readonly FaceVm[];
  /** «Бръснар: Иван, Стефан. Промени филтъра». */
  readonly label: string;
  /** «Махни филтъра Бръснар» — what Backspace says. */
  readonly removeLabel: string;
}

/** One row of the dropdown; pressing it does `dropdownAction`. */
export interface DropdownRowVm {
  /** `FIELD:BARBER`, `BARBER:ivan`, `REMOVE:BARBER`, `CALENDAR:DAY` — `data-suggestion`. */
  readonly id: string;
  readonly label: string;
  /** The key a matched value belongs to («Бръснар»), or a held key's value. */
  readonly detail: string | null;
  readonly glyph: UiIconName | null;
  readonly face: FaceVm | null;
  /** A value of a held filter: whether it is chosen; null for any other row. */
  readonly checked: boolean | null;
  readonly destructive: boolean;
  readonly dropdownAction: DropdownAction;
  readonly searchFilterField: SearchFilterField;
  /** The single value it adds or toggles; null for a key, a removal, a calendar row. */
  readonly filter: SearchFilter | null;
}

export interface DropdownSectionVm {
  readonly id: string;
  /** «Филтрирай по», «Бръснар»; null for a section that needs none. */
  readonly heading: string | null;
  /** The keys as one line of chips under matched values; rows otherwise. */
  readonly compact: boolean;
  readonly rows: readonly DropdownRowVm[];
}

/** The month inside the dropdown, while a day or a span is being picked. */
export interface DropdownCalendarVm {
  readonly calendarMode: CalendarMode;
  /** The day picked so far (a span's first end), or the held one-day filter. */
  readonly selected: LocalDate | null;
  readonly today: LocalDate;
  /** «Избери ден» · «От 5 ноем. · избери последния ден». */
  readonly caption: string;
}

/** The list under the field. Nothing to show (no section, no month) is a closed dropdown. */
export interface SearchDropdownVm {
  readonly dropdownMode: DropdownMode;
  readonly sections: readonly DropdownSectionVm[];
  readonly calendar: DropdownCalendarVm | null;
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
  /** «Име, телефон, имейл, услуга…», or «Търси…» beside tokens. */
  readonly placeholder: string;
  readonly tokens: readonly TokenVm[];
  readonly dropdown: SearchDropdownVm;
  readonly recents: readonly RecentVm[];
  /** «Телефон +359 88 333…» — only when the text reads as a number. */
  readonly phoneRow: string | null;
  /** The result groups: a heading and its event cards. */
  readonly groups: readonly VisitSectionVm[];
  /** «Махни филтрите» on an empty result with tokens; else null. */
  readonly clearFilters: string | null;
  /** The quiet notes under the sheet: capped, out of date, more than shown. */
  readonly footnotes: readonly string[];
}
