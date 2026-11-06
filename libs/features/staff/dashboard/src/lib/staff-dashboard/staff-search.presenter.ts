import {
  ClientQueryShape,
  DayBucket,
  MatchMode,
  SearchFilter,
  SearchFilterField,
  SearchQuery,
  SearchWhenPreset,
  ServiceVariantPick,
  type ShopNow,
  type TextSegment,
} from '@core/components';
import { coverRowsOf } from '../shared/cover-rows';
import type { Appointment } from '@core/entities';
import {
  type BarberId,
  type BookingStatus,
  type LocalDate,
  type ServiceId,
  type ServiceVariantId,
  type TimeZone,
} from '@core/primitives';
import {
  ClientQuerySystem,
  PhoneSystem,
  type ReadQuery,
  SearchFilterSystem,
  type SearchIndex,
  SearchQuerySystem,
  type SearchSuggestions,
  TextMatchSystem,
  VisitListSystem,
  VisitStorySystem,
} from '@core/systems';
import {
  type AppointmentRowVm,
  type StaffEventLine,
  type VisitBuilderWords,
  type VisitLookup,
  VisitGrain,
  VisitPerspective,
  type VisitSectionVm,
  visitRowOf,
} from '@creativo/features/shared/visits';
import type { UiIconName } from '@creativo/ui/controls';
import { formatWallClock } from '@creativo/ui/wall-clock';
import { BOOKING_STATUS_ICONS } from './staff-day.vm';
import {
  phoneAsTyped,
  searchGlyphOf,
} from '../visit-editor/visit-client-row.presenter';
import {
  CalendarMode,
  SuggestAction,
  type SuggestionCalendarVm,
  SuggestMode,
  type SuggestionRowVm,
  type SuggestionSectionVm,
  type FaceVm,
  type RecentVm,
  type SearchSuggestionsVm,
  SearchSheetState,
  type SearchSheetVm,
  type FilterChipVm,
  type CommitRowVm,
  type SeeAllVm,
  type ServiceRowVm,
  type ServiceTileVm,
  type TextChipVm,
} from './staff-search.vm';
import type { StaffSearchWords } from './staff-search.words';

/*
 * THE SEARCH SHEET, WORDED (Law 10). What matches, which filters can still
 * narrow, which names hold the typed text, how the visits group under their
 * days and what the numbers read as are the systems' (`SearchFilterSystem`,
 * `TextMatchSystem`, `VisitListSystem.dayGroups`, `PhoneSystem`); this words
 * them — the chosen filters as chips, the suggested keys and values, headings, the
 * event cards' matched lines — and marks the runs `TextMatchSystem` found.
 */

/** The catalogue's covers and variants, for the service grid (built from the catalogue's service view models). */
export interface SearchServiceArt {
  /** The service's cover, or null for the placeholder. */
  readonly coverSrc: (id: ServiceId) => string | null;
  /** The variants a service is offered at, in the catalogue's order; none for a plain service. */
  readonly variantsOf: (id: ServiceId) => readonly ServiceVariantId[];
  /** «Дълга коса» — a variant's name, by its service AND its id. */
  readonly variantName: (pick: ServiceVariantPick) => string | null;
}

/** What the sheet is worded from. */
export interface SearchSheetInput {
  readonly query: SearchQuery;
  /** The window, and the folded index built from it when it was replaced. */
  readonly pool: readonly Appointment[];
  readonly index: SearchIndex;
  readonly recents: readonly SearchQuery[];
  /** The page's "now" in its zone: today's heading, the date presets. */
  readonly shopNow: ShopNow;
  readonly timeZone: TimeZone;
  /** Each visit's own shop's "now" (the physical chair invariant, Law 7.2). */
  readonly shopNowAt: (visit: Appointment) => ShopNow | null;
  readonly locale: string;
  /** The shop's dial code: `088…` is read as `359 88…`. */
  readonly callingCode: string;
  readonly lookup: VisitLookup;
  readonly serviceArt: SearchServiceArt;
  readonly rowWords: VisitBuilderWords;
  readonly words: StaffSearchWords;
  /** Every name a visit is findable by as a client (contact, guests, companions). */
  readonly clientNames: (visit: Appointment) => readonly string[];
  /** «Клиент без име» — a visit that has no name anywhere. */
  readonly unnamedClient: string;
  readonly capped: boolean;
  readonly stale: boolean;
  /** The key whose values are suggested — being picked, or a chosen filter pressed; null for none. */
  readonly openField: SearchFilterField | null;
  /** The text as typed: with a key open, what narrows its values. */
  readonly typedText: string;
  /** The set being picked for an open many-valued key, before «Приложи»; null when none is ticked. */
  readonly draft: SearchFilter | null;
  /** The texts taken as filters (Return or ✓), in the order taken. */
  readonly committedTexts: readonly string[];
  /** The month open in the suggestions for a day or a span; null for none. */
  readonly calendarMode: CalendarMode | null;
  /** A span's first picked end; null before it. */
  readonly rangeStart: LocalDate | null;
}

/** The value a chip or suggestion stands for, as the single-value filter it adds or removes. */
function singleValues(filter: SearchFilter): readonly SearchFilter[] {
  switch (filter.searchFilterField) {
    case SearchFilterField.Barber:
      return filter.filterBarberIds.map((id) => singleBarber(id));
    case SearchFilterField.Service:
      return [
        ...filter.filterServiceIds.map((id) => singleService(id)),
        ...filter.filterVariants.map((pick) => singleVariant(pick)),
      ];
    case SearchFilterField.Status:
      return filter.filterBookingStatuses.map((status) => singleStatus(status));
    case SearchFilterField.When:
    case SearchFilterField.Note:
      return [filter];
  }
}

const singleBarber = (id: BarberId): SearchFilter => ({
  searchFilterField: SearchFilterField.Barber,
  filterBarberIds: [id],
});
const singleService = (id: ServiceId): SearchFilter =>
  SearchFilter.service([id], []);
const singleVariant = (pick: ServiceVariantPick): SearchFilter =>
  SearchFilter.service([], [pick]);
const singleStatus = (status: BookingStatus): SearchFilter => ({
  searchFilterField: SearchFilterField.Status,
  filterBookingStatuses: [status],
});

function dayLabel(day: LocalDate, locale: string): string {
  return formatWallClock(day, null, locale, { day: 'numeric', month: 'short' });
}

function whenLabel(filter: SearchFilter.When, input: SearchSheetInput): string {
  const preset = SearchFilterSystem.presetOf(filter, input.shopNow);
  if (preset !== null) return presetWord(preset, input.words);
  return filter.filterFromDate === filter.filterToDate
    ? dayLabel(filter.filterFromDate, input.locale)
    : `${dayLabel(filter.filterFromDate, input.locale)} – ${dayLabel(filter.filterToDate, input.locale)}`;
}

/** A single-value filter's label, in the reader's words. */
function labelOf(filter: SearchFilter, input: SearchSheetInput): string {
  switch (filter.searchFilterField) {
    case SearchFilterField.Barber:
      return (
        input.lookup.barberName(filter.filterBarberIds[0] as BarberId) ??
        input.rowWords.barberRole
      );
    case SearchFilterField.Service: {
      const variant = filter.filterVariants[0];
      if (variant === undefined) {
        return (
          input.lookup.serviceName(filter.filterServiceIds[0] as ServiceId) ??
          input.rowWords.unknownService
        );
      }
      // A variant names its service too: «Подстрижка с ножица · Дълга».
      const serviceName =
        input.lookup.serviceName(variant.serviceId) ??
        input.rowWords.unknownService;
      const variantName = input.serviceArt.variantName(variant);
      return variantName === null
        ? serviceName
        : `${serviceName} · ${variantName}`;
    }
    case SearchFilterField.Status:
      return input.words.statusWord(
        filter.filterBookingStatuses[0] as BookingStatus,
      );
    case SearchFilterField.When:
      return whenLabel(filter, input);
    case SearchFilterField.Note:
      return input.words.withNote;
  }
}

/** A single value's id: `BARBER:ivan`, `WHEN:2026-11-04..2026-11-10`, `NOTE`. */
function filterKey(filter: SearchFilter): string {
  switch (filter.searchFilterField) {
    case SearchFilterField.Barber:
      return `BARBER:${filter.filterBarberIds[0]}`;
    case SearchFilterField.Service:
      return filter.filterVariants[0] === undefined
        ? `SERVICE:${filter.filterServiceIds[0]}`
        : `VARIANT:${ServiceVariantPick.keyOf(filter.filterVariants[0])}`;
    case SearchFilterField.Status:
      return `STATUS:${filter.filterBookingStatuses[0]}`;
    case SearchFilterField.When:
      return `WHEN:${filter.filterFromDate}..${filter.filterToDate}`;
    case SearchFilterField.Note:
      return 'NOTE';
  }
}

/** The kinds of filter, in the order the key chips stand in. */
const FIELD_ORDER: readonly SearchFilterField[] = [
  SearchFilterField.When,
  SearchFilterField.Barber,
  SearchFilterField.Service,
  SearchFilterField.Status,
  SearchFilterField.Note,
];

/** The values a chip names before it says «+N». */
const NAMED_VALUES = 2;
/** The faces a barber chip leads with. */
const CHIP_FACES = 3;
/** The matched values suggested under typed text. */
const MATCHED_VALUES = 5;

function glyphOf(field: SearchFilterField): UiIconName {
  switch (field) {
    case SearchFilterField.When:
      return 'visit.calendar';
    case SearchFilterField.Barber:
      return 'contact.person';
    case SearchFilterField.Service:
      return 'nav.services';
    case SearchFilterField.Status:
      return 'visit.confirmed';
    case SearchFilterField.Note:
      return 'visit.note';
  }
}

function keyOf(field: SearchFilterField, words: StaffSearchWords): string {
  switch (field) {
    case SearchFilterField.When:
      return words.whenKey;
    case SearchFilterField.Barber:
      return words.barberKey;
    case SearchFilterField.Service:
      return words.serviceKey;
    case SearchFilterField.Status:
      return words.statusKey;
    case SearchFilterField.Note:
      return words.noteKey;
  }
}

function presetWord(preset: SearchWhenPreset, words: StaffSearchWords): string {
  switch (preset) {
    case SearchWhenPreset.Today:
      return words.today;
    case SearchWhenPreset.Tomorrow:
      return words.tomorrow;
    case SearchWhenPreset.Yesterday:
      return words.yesterday;
    case SearchWhenPreset.ThisWeek:
      return words.thisWeek;
    case SearchWhenPreset.PastWeek:
      return words.pastWeek;
  }
}

/** The filter of a kind the query holds, or null. */
function heldOf(
  query: SearchQuery,
  field: SearchFilterField,
): SearchFilter | null {
  return (
    query.searchFilters.find((held) => held.searchFilterField === field) ?? null
  );
}

function faceOf(id: BarberId, input: SearchSheetInput): FaceVm {
  return {
    src: input.lookup.barberAvatarSrc(id),
    name: input.lookup.barberName(id) ?? input.rowWords.barberRole,
  };
}

/** «Иван, Стефан +1» — the first values named, the rest counted. */
function valueOf(filter: SearchFilter, input: SearchSheetInput): string {
  if (filter.searchFilterField === SearchFilterField.Note) {
    return input.words.hasNote;
  }
  const names = singleValues(filter).map((one) => labelOf(one, input));
  const named = names.slice(0, NAMED_VALUES).join(', ');
  return names.length > NAMED_VALUES
    ? `${named} ${input.words.moreValues(names.length - NAMED_VALUES)}`
    : named;
}

function filterChipOf(
  field: SearchFilterField,
  held: SearchFilter | null,
  input: SearchSheetInput,
): FilterChipVm {
  const key = keyOf(field, input.words);
  const active = input.openField === field;
  // The open chip says what is being typed into it (Mail: «From: “ни”»).
  const typed = active ? input.typedText.trim() : '';
  if (typed !== '') {
    return {
      id: field,
      label: input.words.chipTyped(key, typed),
      glyph: glyphOf(field),
      faces: [],
      facesOverflow: 0,
      accessibleLabel: input.words.chipTyped(key, typed),
      active,
    };
  }
  if (held === null) {
    return {
      id: field,
      label: key,
      glyph: glyphOf(field),
      faces: [],
      facesOverflow: 0,
      accessibleLabel: input.words.tokenBuilding(key),
      active,
    };
  }
  const value = valueOf(held, input);
  return {
    id: field,
    // A note's value («има») reads only beside its key; alone it is «С бележка».
    label:
      held.searchFilterField === SearchFilterField.Note
        ? input.words.withNote
        : value,
    glyph: glyphOf(field),
    faces:
      held.searchFilterField === SearchFilterField.Barber
        ? held.filterBarberIds
            .slice(0, CHIP_FACES)
            .map((id) => faceOf(id, input))
        : [],
    facesOverflow:
      held.searchFilterField === SearchFilterField.Barber
        ? Math.max(0, held.filterBarberIds.length - CHIP_FACES)
        : 0,
    accessibleLabel: input.words.tokenLabel(key, value),
    active,
  };
}

/** One chip per chosen filter, in the order they were added, then the key being picked. */
function filterChipsOf(
  query: SearchQuery,
  openField: SearchFilterField | null,
  input: SearchSheetInput,
): readonly FilterChipVm[] {
  const chips: FilterChipVm[] = [];
  for (const held of query.searchFilters) {
    chips.push(filterChipOf(held.searchFilterField, held, input));
  }
  if (openField !== null && heldOf(query, openField) === null) {
    chips.push(filterChipOf(openField, null, input));
  }
  return chips;
}

/** Is this single value one the draft holds? */
function isInDraft(filter: SearchFilter, draft: SearchFilter | null): boolean {
  if (draft === null) return false;
  const key = filterKey(filter);
  return singleValues(draft).some((value) => filterKey(value) === key);
}

/** Is this single value one the held filter of its kind holds? */
function isHeldValue(filter: SearchFilter, query: SearchQuery): boolean {
  const held = heldOf(query, filter.searchFilterField);
  if (held === null) return false;
  const key = filterKey(filter);
  return singleValues(held).some((value) => filterKey(value) === key);
}

function valueRow(
  filter: SearchFilter,
  input: SearchSheetInput,
  shape: {
    readonly checked: boolean | null;
    readonly detail: string | null;
    readonly suggestAction: SuggestAction;
  },
): SuggestionRowVm {
  const label = labelOf(filter, input);
  return {
    id: filterKey(filter),
    label,
    parts: plainRuns(label),
    detail: shape.detail,
    // A state wears its own mark (the calendar's), a barber their face.
    glyph:
      filter.searchFilterField === SearchFilterField.Status
        ? BOOKING_STATUS_ICONS[filter.filterBookingStatuses[0] as BookingStatus]
        : null,
    face:
      filter.searchFilterField === SearchFilterField.Barber
        ? faceOf(filter.filterBarberIds[0] as BarberId, input)
        : null,
    checked: shape.checked,
    destructive: false,
    suggestAction: shape.suggestAction,
    searchFilterField: filter.searchFilterField,
    filter,
  };
}

function keyRow(
  field: SearchFilterField,
  input: SearchSheetInput,
): SuggestionRowVm {
  const note = field === SearchFilterField.Note;
  const label = note ? input.words.withNote : keyOf(field, input.words);
  return {
    id: `FIELD:${field}`,
    label,
    parts: plainRuns(label),
    detail: null,
    glyph: glyphOf(field),
    face: null,
    checked: null,
    destructive: false,
    // A note has no values: its key IS the filter.
    suggestAction: note ? SuggestAction.AddValue : SuggestAction.OpenField,
    searchFilterField: field,
    filter: note ? SearchFilter.note() : null,
  };
}

/**
 * The single values of a kind the window still offers, in the order it
 * offers them — a pick never reorders the list under the thumb (owner,
 * 2026-11-05) — then any held value the window no longer offers (a day
 * picked from the month, a barber with nothing left in it), so it can
 * still be taken off.
 */
function valuesOf(
  field: SearchFilterField,
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): readonly SearchFilter[] {
  const held = heldOf(query, field);
  const out: SearchFilter[] = [];
  const add = (filter: SearchFilter): void => {
    if (!out.some((value) => filterKey(value) === filterKey(filter))) {
      out.push(filter);
    }
  };
  switch (field) {
    case SearchFilterField.Barber:
      for (const id of offered.barberIds) add(singleBarber(id));
      break;
    case SearchFilterField.Service:
      // Grouped by service: a service offered at variants stands as its
      // variants, one after another, then the next service.
      for (const id of offered.serviceIds) {
        const picks = input.serviceArt
          .variantsOf(id)
          .filter((variant) =>
            offered.variants.some(
              (pick) => pick.serviceId === id && pick.variantId === variant,
            ),
          )
          .map((variant) => ServiceVariantPick.of(id, variant));
        if (picks.length === 0) add(singleService(id));
        else for (const pick of picks) add(singleVariant(pick));
      }
      break;
    case SearchFilterField.Status:
      for (const status of offered.bookingStatuses) add(singleStatus(status));
      break;
    case SearchFilterField.When:
      // The held span answers only as itself; the presets the window reaches follow.
      for (const preset of offered.whenPresets) {
        add(SearchFilterSystem.whenOf(preset, input.shopNow));
      }
      break;
    case SearchFilterField.Note:
      break;
  }
  if (held !== null) for (const value of singleValues(held)) add(value);
  return out;
}

/** The FREE keys a filter can be made of — those that still narrow, none chosen or being picked (those are chips of their own). */
function keyRowsOf(
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): readonly SuggestionRowVm[] {
  const offers = (field: SearchFilterField): boolean => {
    switch (field) {
      case SearchFilterField.When:
        // A day or a span can always be picked, whatever the window reaches.
        return true;
      case SearchFilterField.Barber:
        return offered.barberIds.length > 0;
      case SearchFilterField.Service:
        return offered.serviceIds.length > 0;
      case SearchFilterField.Status:
        return offered.bookingStatuses.length > 0;
      case SearchFilterField.Note:
        return offered.hasNote;
    }
  };
  return FIELD_ORDER.filter(
    (field) =>
      offers(field) &&
      heldOf(query, field) === null &&
      field !== input.openField,
  ).map((field) => keyRow(field, input));
}

function calendarOf(
  query: SearchQuery,
  input: SearchSheetInput,
): SuggestionCalendarVm | null {
  const mode = input.calendarMode;
  if (mode === null || input.openField !== SearchFilterField.When) return null;
  const held = heldOf(query, SearchFilterField.When);
  if (mode === CalendarMode.Range) {
    return {
      calendarMode: mode,
      selected: input.rangeStart,
      today: input.shopNow.localDate,
      caption:
        input.rangeStart === null
          ? input.words.rangeFirstCaption
          : input.words.rangeLastCaption(
              dayLabel(input.rangeStart, input.locale),
            ),
    };
  }
  return {
    calendarMode: mode,
    selected:
      held !== null &&
      held.searchFilterField === SearchFilterField.When &&
      held.filterFromDate === held.filterToDate
        ? held.filterFromDate
        : null,
    today: input.shopNow.localDate,
    caption: input.words.pickDayCaption,
  };
}

function calendarRow(
  calendarMode: CalendarMode,
  input: SearchSheetInput,
): SuggestionRowVm {
  const day = calendarMode === CalendarMode.Day;
  const label = day ? input.words.pickDay : input.words.pickRange;
  return {
    id: `CALENDAR:${calendarMode}`,
    label,
    parts: plainRuns(label),
    detail: null,
    // No glyph: it lines up with the presets above it, words all.
    glyph: null,
    face: null,
    checked: null,
    destructive: false,
    suggestAction: day ? SuggestAction.PickDay : SuggestAction.PickRange,
    searchFilterField: SearchFilterField.When,
    filter: null,
  };
}

/** The open key's values: ✓ on the held ones, the typed text narrowing them. */
function valueSuggestions(
  field: SearchFilterField,
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): SearchSuggestionsVm {
  const calendar = calendarOf(query, input);
  if (calendar !== null) {
    return {
      suggestMode: SuggestMode.Values,
      keys: [],
      sections: [],
      calendar,
      serviceRows: [],
      apply: null,
    };
  }
  const held = heldOf(query, field);
  const text = input.typedText.trim();
  // A many-valued kind is ticked as a set and applied once («Приложи»); a
  // span replaces the held one on a tap and closes the key.
  const many = SearchFilter.holdsMany(field);
  const rows = valuesOf(field, offered, query, input)
    .map((filter) =>
      valueRow(filter, input, {
        checked: many
          ? isInDraft(filter, input.draft)
          : held === null
            ? null
            : isHeldValue(filter, query),
        detail: null,
        suggestAction: many
          ? SuggestAction.ToggleValue
          : SuggestAction.AddValue,
      }),
    )
    .filter((row) => namesText(row.label, text))
    .map((row) => marked(row, text));
  if (field === SearchFilterField.When) {
    rows.push(
      calendarRow(CalendarMode.Day, input),
      calendarRow(CalendarMode.Range, input),
    );
  }
  // A service's values are a GRID of covers (the booking catalogue's card),
  // not rows; the key still heads them.
  const serviceRows =
    field === SearchFilterField.Service
      ? rowsByService(rows.map((row) => serviceTileOf(row, input)))
      : [];
  const sections: SuggestionSectionVm[] =
    field === SearchFilterField.Service
      ? []
      : [
          {
            id: `VALUES:${field}`,
            heading: keyOf(field, input.words),
            rows,
            prominent: false,
            faces: field === SearchFilterField.Barber,
            seeAll: null,
          },
        ];
  if (held !== null) {
    sections.push({
      id: 'REMOVE',
      heading: null,
      prominent: false,
      faces: false,
      seeAll: null,
      rows: [
        {
          id: `REMOVE:${field}`,
          label: input.words.removeFilter,
          parts: plainRuns(input.words.removeFilter),
          detail: null,
          glyph: 'action.remove',
          face: null,
          checked: null,
          destructive: true,
          suggestAction: SuggestAction.RemoveFilter,
          searchFilterField: field,
          filter: null,
        },
      ],
    });
  }
  const ticked = input.draft === null ? 0 : singleValues(input.draft).length;
  return {
    suggestMode: SuggestMode.Values,
    keys: [],
    sections,
    calendar: null,
    serviceRows,
    apply: many
      ? {
          label:
            ticked === 0 ? input.words.apply : input.words.applyCount(ticked),
        }
      : null,
  };
}

/**
 * What the sheet suggests. With a key open, its values (rows above the
 * results). With nothing typed, every free key (the card over the field,
 * Photos') and, on an untouched search, the starters above the recents,
 * under their keys. With text typed, the values whose name holds it, under
 * their keys (Mail's «Suggestions» above the results), and only the keys it
 * names — the rest leave, so typing narrows the suggestions rather than
 * standing beside them. The typed run is marked wherever it was found.
 */
function suggestionsOf(
  query: SearchQuery,
  offered: SearchSuggestions,
  input: SearchSheetInput,
): SearchSuggestionsVm {
  if (input.openField !== null) {
    return valueSuggestions(input.openField, offered, query, input);
  }
  const text = input.typedText.trim();
  // Under typed text a pick TAKES the text (it named the value or the key),
  // so what is offered is what narrows the search without it.
  const bare =
    text === ''
      ? offered
      : SearchFilterSystem.suggestions(
          input.index,
          SearchQuerySystem.read('', input.callingCode),
          query.searchFilters,
          input.shopNow,
        );
  const keys = keyRowsOf(bare, query, input);
  if (text === '') {
    // An untouched search opens on what it can start from (Mail's «Suggestions»).
    const starters = SearchQuery.isEmpty(query)
      ? SearchFilterSystem.starters(offered, input.shopNow).map((filter) =>
          valueRow(filter, input, {
            checked: null,
            detail: null,
            suggestAction: SuggestAction.AddValue,
          }),
        )
      : [];
    return {
      suggestMode: SuggestMode.Fields,
      keys,
      sections: byKey('STARTERS', starters, offered, input),
      calendar: null,
      serviceRows: [],
      apply: null,
    };
  }
  const matched: SuggestionRowVm[] = [];
  for (const field of FIELD_ORDER) {
    for (const filter of valuesOf(field, bare, SearchQuery.empty(), input)) {
      if (matched.length === MATCHED_VALUES) break;
      if (isHeldValue(filter, query)) continue;
      const row = valueRow(filter, input, {
        checked: null,
        detail: null,
        suggestAction: SuggestAction.AddValue,
      });
      if (namesText(row.label, text)) matched.push(marked(row, text));
    }
  }
  return {
    suggestMode: SuggestMode.Matches,
    // Only the keys the text names stay («бръ» → Бръснар), the run marked.
    keys: keys
      .filter((row) => namesText(row.label, text))
      .map((row) => marked(row, text)),
    sections: byKey('MATCHES', matched, bare, input),
    calendar: null,
    serviceRows: [],
    apply: null,
  };
}

/**
 * The rows under the key they belong to («Кога»: Днес, Утре · «Бръснар»: …),
 * one section per run of a kind, in the order the rows came.
 */
function byKey(
  prefix: string,
  rows: readonly SuggestionRowVm[],
  offered: SearchSuggestions,
  input: SearchSheetInput,
): readonly SuggestionSectionVm[] {
  const sections: {
    id: string;
    heading: string;
    rows: SuggestionRowVm[];
    prominent: true;
    faces: boolean;
    seeAll: SeeAllVm | null;
  }[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (
      last !== undefined &&
      last.id === `${prefix}:${row.searchFilterField}`
    ) {
      last.rows.push(row);
    } else {
      const key = keyOf(row.searchFilterField, input.words);
      sections.push({
        id: `${prefix}:${row.searchFilterField}`,
        heading: key,
        rows: [row],
        prominent: true,
        faces: row.searchFilterField === SearchFilterField.Barber,
        seeAll: null,
      });
    }
  }
  // A group that leaves some of its key's values out points on to them.
  return sections.map((section) => {
    const field = section.rows[0]?.searchFilterField;
    if (field === undefined) return section;
    const shown: SearchFilter[] = [];
    for (const row of section.rows)
      if (row.filter !== null) shown.push(row.filter);
    return SearchFilterSystem.offersBeyond(field, offered, shown)
      ? {
          ...section,
          seeAll: {
            searchFilterField: field,
            label: input.words.seeAll,
            accessibleLabel: input.words.seeAllOf(section.heading),
          },
        }
      : section;
  });
}

/** A service value as a cover tile: the service's name, and a variant's under it. */
function serviceTileOf(
  row: SuggestionRowVm,
  input: SearchSheetInput,
): ServiceTileVm {
  const filter = row.filter as SearchFilter.Service;
  const variant = filter.filterVariants[0];
  const service =
    variant === undefined
      ? (filter.filterServiceIds[0] as ServiceId)
      : variant.serviceId;
  const serviceName =
    input.lookup.serviceName(service) ?? input.rowWords.unknownService;
  const variantName =
    variant === undefined ? null : input.serviceArt.variantName(variant);
  return {
    id: row.id,
    serviceId: service,
    // The SERVICE leads (owner, 2026-11-05); a variant says which, quieter.
    name: serviceName,
    meta: variantName ?? '',
    coverSrc: input.serviceArt.coverSrc(service),
    checked: row.checked === true,
    row,
  };
}

/** The tiles as grids (`coverRowsOf`, shared with the visit sheet's catalogue). */
function rowsByService(
  tiles: readonly ServiceTileVm[],
): readonly ServiceRowVm[] {
  return coverRowsOf(
    tiles,
    (tile) => tile.serviceId,
    (tile) =>
      (tile.row.filter as SearchFilter.Service).filterVariants.length > 0,
  );
}

/** A label as one unmarked run. */
function plainRuns(label: string): readonly TextSegment[] {
  return [{ text: label, hit: false }];
}

/** The row with the typed run marked where a word of its label starts with it. */
function marked(row: SuggestionRowVm, text: string): SuggestionRowVm {
  return text === ''
    ? row
    : {
        ...row,
        parts: TextMatchSystem.segmentsAny(
          row.label,
          [text],
          MatchMode.WordStart,
        ),
      };
}

/** Does a name hold the typed text at the start of one of its words (the add-client page's rule)? */
function namesText(label: string, text: string): boolean {
  return (
    text === '' ||
    TextMatchSystem.segmentsAny(label, [text], MatchMode.WordStart).some(
      (part) => part.hit,
    )
  );
}

/**
 * How a text reads — the add-client page's reading (`ClientQuerySystem`): a
 * number shown as it would be dialled («088 77» → «+359 88 77»), an
 * e-mail or words as typed — and the glyph that says which.
 */
function readingOf(
  text: string,
  input: SearchSheetInput,
): {
  readonly shape: ClientQueryShape;
  readonly shown: string;
  readonly glyph: UiIconName;
} {
  const parsed = ClientQuerySystem.parse(text);
  const shape = parsed.clientQueryShape;
  return {
    shape,
    shown:
      shape === ClientQueryShape.Phone
        ? phoneAsTyped(parsed, input.callingCode)
        : text,
    glyph: searchGlyphOf(shape),
  };
}

/** The taken texts as chips, in the order taken. */
function textChipsOf(input: SearchSheetInput): readonly TextChipVm[] {
  return input.committedTexts.map((text, at) => {
    const reading = readingOf(text, input);
    const label =
      reading.shape === ClientQueryShape.Phone
        ? input.words.chipPhone(reading.shown)
        : reading.shown;
    return {
      id: `TEXT:${at}`,
      label,
      glyph: reading.glyph,
      accessibleLabel: input.words.textChipLabel(label),
    };
  });
}

/** The typed text, offered to be taken as a filter (Mail's «Subject contains …»). */
function commitRowOf(input: SearchSheetInput): CommitRowVm | null {
  const text = input.typedText.trim();
  if (text === '' || input.openField !== null) return null;
  const reading = readingOf(text, input);
  switch (reading.shape) {
    case ClientQueryShape.Phone:
      return {
        label: input.words.commitPhone(reading.shown),
        glyph: reading.glyph,
      };
    case ClientQueryShape.Email:
      return {
        label: input.words.commitEmail(reading.shown),
        glyph: reading.glyph,
      };
    case ClientQueryShape.Name:
    case ClientQueryShape.Empty:
      return {
        label: input.words.commitText(reading.shown),
        glyph: reading.glyph,
      };
  }
}

function recentsOf(input: SearchSheetInput): readonly RecentVm[] {
  return input.recents.map((query, index) => {
    const parts = [
      query.searchText.trim(),
      ...filterChipsOf(query, null, input).map((chip) => chip.label),
    ].filter((part) => part.length > 0);
    return { id: `recent-${index}`, label: parts.join(' · '), query };
  });
}

/** The lines a card adds for what the query found: the client always, the rest only when matched. */
function matchLinesOf(
  visit: Appointment,
  read: ReadQuery,
  input: SearchSheetInput,
): readonly StaffEventLine[] {
  const lines: StaffEventLine[] = [];
  const terms = read.queryTerms;
  const mark = (text: string): readonly TextSegment[] =>
    TextMatchSystem.segmentsAny(text, terms, MatchMode.Anywhere);
  const hits = (parts: readonly TextSegment[]): boolean =>
    parts.some((part) => part.hit);

  // WHO: every card names its client (a filter alone would leave the cards
  // anonymous), marked when the typed words found them.
  const names = input.clientNames(visit);
  const named =
    names.find((name) => hits(mark(name))) ?? names[0] ?? input.unnamedClient;
  lines.push({
    text: named,
    icon: 'contact.person',
    testId: 'staff-search-line-client',
    parts: mark(named),
  });

  if (visit.contactPhone !== null) {
    const formatted = PhoneSystem.formatInternational(visit.contactPhone);
    const run = PhoneSystem.readingRun(read.queryPhone, formatted);
    if (run !== null) {
      lines.push({
        text: formatted,
        icon: 'contact.phone',
        testId: 'staff-search-line-phone',
        parts: TextMatchSystem.phoneSegments(formatted, run),
      });
    }
  }
  if (visit.contactEmail !== null) {
    const parts = mark(visit.contactEmail);
    if (hits(parts)) {
      lines.push({
        text: visit.contactEmail,
        icon: 'contact.email',
        testId: 'staff-search-line-email',
        parts,
      });
    }
  }
  if (visit.contactNote) {
    const parts = mark(visit.contactNote);
    if (hits(parts)) {
      lines.push({
        text: visit.contactNote,
        icon: 'visit.note',
        testId: 'staff-search-line-note',
        parts,
      });
    }
  }
  return lines;
}

function headingOf(
  bucket: DayBucket,
  date: LocalDate | null,
  input: SearchSheetInput,
): string {
  switch (bucket) {
    case DayBucket.Today:
      return input.words.today;
    case DayBucket.Tomorrow:
      return input.words.tomorrow;
    case DayBucket.Past:
      return input.words.earlier;
    case DayBucket.Later:
      return formatWallClock(date as LocalDate, null, input.locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
  }
}

function groupsOf(
  visits: readonly Appointment[],
  read: ReadQuery,
  input: SearchSheetInput,
): readonly VisitSectionVm[] {
  const ordered = VisitStorySystem.outwardFromNow(visits, input.shopNowAt).map(
    ({ visit }) => visit,
  );
  return VisitListSystem.dayGroups(ordered, input.shopNow.localDate).map(
    (group) => ({
      key: group.groupKey,
      label: headingOf(group.dayBucket, group.groupDate, input),
      detail: null,
      testId: `staff-search-group-${group.groupKey}`,
      rows: group.visits.map((visit): AppointmentRowVm =>
        visitRowOf(
          visit,
          {
            perspective: VisitPerspective.Staff,
            grain: VisitGrain.Month,
            subjectUserId: null,
            subjectCustomerId: null,
            currentAppointmentId: null,
            now: input.shopNow,
            timeZone: input.timeZone,
            locale: input.locale,
            words: input.rowWords,
            matched: {
              titleTerms: read.queryTerms,
              matchLines: matchLinesOf(visit, read, input),
            },
          },
          input.lookup,
        ),
      ),
    }),
  );
}

/** The sheet, worded: the filter chips and recents, the suggestions, and the cards under their days. */
export function searchSheetVm(input: SearchSheetInput): SearchSheetVm {
  const query = input.query;
  const read = SearchQuerySystem.read(query.searchText, input.callingCode);
  const filters = filterChipsOf(query, input.openField, input);
  const idle = SearchQuery.isEmpty(query);
  const offered = SearchFilterSystem.suggestions(
    input.index,
    read,
    query.searchFilters,
    input.shopNow,
  );
  const suggestions = suggestionsOf(query, offered, input);
  // What the FIELD's text reads as — the taken texts wear their own glyphs.
  const glyph = searchGlyphOf(
    ClientQuerySystem.parse(input.typedText).clientQueryShape,
  );
  // With a key open the text narrows its values, and the field says so.
  const placeholder =
    input.openField !== null
      ? input.words.scopedPlaceholder(keyOf(input.openField, input.words))
      : filters.length > 0 || input.committedTexts.length > 0
        ? input.words.placeholderShort
        : input.words.placeholder;
  const texts = textChipsOf(input);
  const commitRow = commitRowOf(input);
  const footnotes: string[] = [];
  if (input.capped) footnotes.push(input.words.truncated);
  if (input.stale) footnotes.push(input.words.stale);

  if (idle) {
    return {
      searchSheetState: SearchSheetState.Idle,
      glyph,
      placeholder,
      filters,
      suggestions,
      recents: recentsOf(input),
      texts,
      commitRow,
      groups: [],
      clearFilters: null,
      footnotes,
    };
  }

  const kept = SearchFilterSystem.keep(input.index, read, query.searchFilters);
  const shown = kept.slice(0, SearchFilterSystem.RESULT_LIMIT);
  if (kept.length > shown.length) {
    footnotes.push(input.words.moreThanShown(shown.length));
  }
  const visits = shown.map((at) => input.pool[at] as Appointment);
  return {
    searchSheetState:
      kept.length === 0 ? SearchSheetState.Empty : SearchSheetState.Results,
    glyph,
    placeholder,
    filters,
    suggestions,
    recents: [],
    texts,
    commitRow,
    groups: groupsOf(visits, read, input),
    clearFilters:
      kept.length === 0 && query.searchFilters.length > 0
        ? input.words.clearFilters
        : null,
    footnotes,
  };
}
