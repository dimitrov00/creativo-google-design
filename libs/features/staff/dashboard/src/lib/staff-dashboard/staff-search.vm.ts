import type {
  SearchFilter,
  SearchFilterField,
  SearchQuery,
  TextSegment,
} from '@core/components';
import type { LocalDate, ServiceId } from '@core/primitives';
import type { UiIconName } from '@creativo/ui/controls';
import type { VisitSectionVm } from '@creativo/features/shared/visits';

/*
 * THE SEARCH SHEET'S DISPLAY MODEL (Law 10.3): types only. The sheet is one
 * of three states; the filter chips, the recents, the suggestions and the
 * result groups are plain structs. A chip, a suggestion or a recent carries the
 * DATA its press acts on (`searchFilterField`, `filter`, `query`) so the
 * sheet never parses a label or an id. `staff-search.presenter.ts` fills it.
 */

/** What the sheet shows — the field `searchSheetState`. */
export const SearchSheetState = {
  /** Nothing typed and no filter: the starters and the recents. */
  Idle: 'IDLE',
  /** At least one visit matches: the result groups. */
  Results: 'RESULTS',
  /** A search that matches nothing. */
  Empty: 'EMPTY',
} as const;
export type SearchSheetState =
  (typeof SearchSheetState)[keyof typeof SearchSheetState];

/** What the suggestions offer — the field `suggestMode`. */
export const SuggestMode = {
  /** Nothing typed, no key open: the keys a filter can be made of. */
  Fields: 'FIELDS',
  /** A key open (being picked, or a chosen filter pressed): its values. */
  Values: 'VALUES',
  /** Text typed, no key open: the values and the keys the text names. */
  Matches: 'MATCHES',
} as const;
export type SuggestMode = (typeof SuggestMode)[keyof typeof SuggestMode];

/** What pressing a suggestion does — the field `suggestAction`. */
export const SuggestAction = {
  /** A key: open its values (a key with no values adds its filter instead). */
  OpenField: 'OPEN_FIELD',
  /** A value of a single-valued key, a starter or a match: add it, and close the key. */
  AddValue: 'ADD_VALUE',
  /** A value of a many-valued key: tick or untick it in the set being picked; «Приложи» applies the set. */
  ToggleValue: 'TOGGLE_VALUE',
  /** The held filter of the open key, taken off whole. */
  RemoveFilter: 'REMOVE_FILTER',
  /** «Конкретна дата…»: the month opens for one day. */
  PickDay: 'PICK_DAY',
  /** «Период…»: the month opens for two days. */
  PickRange: 'PICK_RANGE',
} as const;
export type SuggestAction = (typeof SuggestAction)[keyof typeof SuggestAction];

/** How the month in the suggestions is being picked — the field `calendarMode`. */
export const CalendarMode = {
  Day: 'DAY',
  Range: 'RANGE',
} as const;
export type CalendarMode = (typeof CalendarMode)[keyof typeof CalendarMode];

/** A face a filter chip or a row leads with — a barber. */
export interface FaceVm {
  readonly src: string | null;
  readonly name: string;
}

/**
 * A chosen filter, floating over the field as a selected chip (≙ iOS 26
 * Photos): the key's glyph or the barbers' faces, and its VALUE. A key being
 * picked stands as its own chip, saying the key, until a value is picked.
 */
export interface FilterChipVm {
  /** The kind it filters — one chip per kind. */
  readonly id: SearchFilterField;
  /** «10.11», «Иван, Стефан +1», «С бележка»; the key («Бръснар») while it is being picked; «Бръснар: „ни“» while text is typed into it. */
  readonly label: string;
  readonly glyph: UiIconName;
  /** The barbers it holds, as faces — one disc, or a group of overlapping ones. */
  readonly faces: readonly FaceVm[];
  /** How many more barbers than the faces drawn (the group's «+N»); 0 for none. */
  readonly facesOverflow: number;
  /** «Бръснар: Иван, Стефан. Промени филтъра» · «Бръснар: избери стойност». */
  readonly accessibleLabel: string;
  /** Its values are open: the chip wears the ring. */
  readonly active: boolean;
}

/** A typed text taken as a filter (Mail's «Subject contains …» token): its reading's glyph and its words. */
export interface TextChipVm {
  /** `TEXT:0` — its place among the taken texts. */
  readonly id: string;
  /** «+359 88 777…» · «ivan@» · «иван». */
  readonly label: string;
  readonly glyph: UiIconName;
  /** «Търсене: иван. Върни в полето». */
  readonly accessibleLabel: string;
}

/** The typed text, offered as a filter before it is taken. */
export interface CommitRowVm {
  readonly label: string;
  readonly glyph: UiIconName;
}

/** One suggestion — a key chip over the field, or a row above the results; pressing it does `suggestAction`. */
export interface SuggestionRowVm {
  /** `FIELD:BARBER`, `BARBER:ivan`, `REMOVE:BARBER`, `CALENDAR:DAY` — `data-suggestion`. */
  readonly id: string;
  readonly label: string;
  /** The label as runs, the typed one marked (`ui-marked-text`). */
  readonly parts: readonly TextSegment[];
  /** A trailing note; none since the suggestions stand under their keys. */
  readonly detail: string | null;
  readonly glyph: UiIconName | null;
  readonly face: FaceVm | null;
  /** A value of a held filter: whether it is chosen; null for any other row. */
  readonly checked: boolean | null;
  readonly destructive: boolean;
  readonly suggestAction: SuggestAction;
  readonly searchFilterField: SearchFilterField;
  /** The single value it adds or toggles; null for a key, a removal, a calendar row. */
  readonly filter: SearchFilter | null;
}

export interface SuggestionSectionVm {
  readonly id: string;
  /** The key its rows belong to («Кога», «Бръснар»); null for a section that needs none. */
  readonly heading: string | null;
  readonly rows: readonly SuggestionRowVm[];
}

/** The month in the suggestions, while a day or a span is being picked. */
export interface SuggestionCalendarVm {
  readonly calendarMode: CalendarMode;
  /** The day picked so far (a span's first end), or the held one-day filter. */
  readonly selected: LocalDate | null;
  readonly today: LocalDate;
  /** «Избери ден» · «От 5 ноем. · избери последния ден». */
  readonly caption: string;
}

/**
 * What the sheet suggests (≙ iOS 26 Photos and Mail): the free KEYS a filter
 * can be made of as chips over the field, and the rows above the results —
 * the starters of an untouched search, the values the typed text names, or
 * an open key's values.
 */
export interface SearchSuggestionsVm {
  readonly suggestMode: SuggestMode;
  /** The free keys in the card over the field (on focus): every one that still narrows, or those the typed text names; none while a key is open. */
  readonly keys: readonly SuggestionRowVm[];
  /** The rows above the results. */
  readonly sections: readonly SuggestionSectionVm[];
  readonly calendar: SuggestionCalendarVm | null;
  /** A service's values as cover cards, ONE ROW PER SERVICE, its variants side by side; none for any other key. */
  readonly serviceRows: readonly ServiceRowVm[];
  /** «Приложи (2)» — the bar's primary while a many-valued key's set is being picked; null otherwise. */
  readonly apply: SuggestionApplyVm | null;
}

/** One service's row of cover cards. */
export interface ServiceRowVm {
  /** The service's id. */
  readonly id: string;
  readonly tiles: readonly ServiceTileVm[];
}

/** One service value as a cover tile (the booking catalogue's `cr-service-card`), ticked like a checkbox. */
export interface ServiceTileVm {
  /** `SERVICE:…` / `VARIANT:…` — `data-suggestion`. */
  readonly id: string;
  /** The service the cover is of. */
  readonly serviceId: ServiceId;
  /** The service's name — it leads. */
  readonly name: string;
  /** The variant («Дълга коса»), under it; '' for a plain service. */
  readonly meta: string;
  readonly coverSrc: string | null;
  readonly checked: boolean;
  /** The row it stands for — what pressing it does. */
  readonly row: SuggestionRowVm;
}

/** The bar's «Приложи» for the set being picked. */
export interface SuggestionApplyVm {
  readonly label: string;
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
  /** «Име, телефон, имейл, услуга…»; «Търси…» with filters chosen; «Търси в „Бръснар“…» with a key open. */
  readonly placeholder: string;
  /** The chosen filters over the field, in the order they were added, then a key being picked. */
  readonly filters: readonly FilterChipVm[];
  readonly suggestions: SearchSuggestionsVm;
  readonly recents: readonly RecentVm[];
  /** The texts taken as filters (Return or ✓), as chips before the filters, in the order taken. */
  readonly texts: readonly TextChipVm[];
  /** «Телефонът започва с „+359 88 777“» — the typed text, offered to be taken as a filter; null with nothing typed or a key open. */
  readonly commitRow: CommitRowVm | null;
  /** The result groups: a heading and its event cards. */
  readonly groups: readonly VisitSectionVm[];
  /** «Махни филтрите» on an empty result with filters; else null. */
  readonly clearFilters: string | null;
  /** The quiet notes under the sheet: capped, out of date, more than shown. */
  readonly footnotes: readonly string[];
}
