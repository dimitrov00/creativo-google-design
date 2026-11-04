import {
  DayBucket,
  MatchMode,
  PhoneReadingKind,
  SearchFilter,
  SearchFilterField,
  SearchQuery,
  SearchWhenPreset,
  type ShopNow,
  type TextSegment,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type BarberId,
  type BookingStatus,
  type LocalDate,
  type ServiceId,
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
import { searchGlyphOf } from '../visit-editor/visit-client-row.presenter';
import {
  CalendarMode,
  DropdownAction,
  type DropdownCalendarVm,
  DropdownMode,
  type DropdownRowVm,
  type DropdownSectionVm,
  type FaceVm,
  type RecentVm,
  type SearchDropdownVm,
  SearchSheetState,
  type SearchSheetVm,
  type TokenVm,
} from './staff-search.vm';
import type { StaffSearchWords } from './staff-search.words';

/*
 * THE SEARCH SHEET, WORDED (Law 10). What matches, which filters can still
 * narrow, which names hold the typed text, how the visits group under their
 * days and what the numbers read as are the systems' (`SearchFilterSystem`,
 * `TextMatchSystem`, `VisitListSystem.dayGroups`, `PhoneSystem`); this words
 * them — the keyed tokens, the dropdown's keys and values, headings, the
 * event cards' matched lines — and marks the runs `TextMatchSystem` found.
 */

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
  readonly rowWords: VisitBuilderWords;
  readonly words: StaffSearchWords;
  /** Every name a visit is findable by as a client (contact, guests, companions). */
  readonly clientNames: (visit: Appointment) => readonly string[];
  /** «Клиент без име» — a visit that has no name anywhere. */
  readonly unnamedClient: string;
  readonly capped: boolean;
  readonly stale: boolean;
  /** The key whose values the dropdown lists — a token being built or pressed; null for none. */
  readonly openField: SearchFilterField | null;
  /** The text as typed: with a key open, what narrows its values. */
  readonly dropdownText: string;
  /** The month open in the dropdown for a day or a span; null for none. */
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
      return filter.filterServiceIds.map((id) => singleService(id));
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
const singleService = (id: ServiceId): SearchFilter => ({
  searchFilterField: SearchFilterField.Service,
  filterServiceIds: [id],
});
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
    case SearchFilterField.Service:
      return (
        input.lookup.serviceName(filter.filterServiceIds[0] as ServiceId) ??
        input.rowWords.unknownService
      );
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
      return `SERVICE:${filter.filterServiceIds[0]}`;
    case SearchFilterField.Status:
      return `STATUS:${filter.filterBookingStatuses[0]}`;
    case SearchFilterField.When:
      return `WHEN:${filter.filterFromDate}..${filter.filterToDate}`;
    case SearchFilterField.Note:
      return 'NOTE';
  }
}

/** The kinds of filter, in the order a token and a key row stand in. */
const FIELD_ORDER: readonly SearchFilterField[] = [
  SearchFilterField.When,
  SearchFilterField.Barber,
  SearchFilterField.Service,
  SearchFilterField.Status,
  SearchFilterField.Note,
];

/** The values a token names before it says «+N». */
const NAMED_VALUES = 2;
/** The faces a barber token leads with. */
const TOKEN_FACES = 3;
/** The matched values the dropdown lists under typed text. */
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

function tokenOf(
  field: SearchFilterField,
  held: SearchFilter | null,
  input: SearchSheetInput,
): TokenVm {
  const key = keyOf(field, input.words);
  if (held === null) {
    return {
      id: field,
      key,
      value: '',
      faces: [],
      label: input.words.tokenBuilding(key),
      removeLabel: input.words.chipRemove(key),
    };
  }
  const value = valueOf(held, input);
  return {
    id: field,
    key,
    value,
    faces:
      held.searchFilterField === SearchFilterField.Barber
        ? held.filterBarberIds
            .slice(0, TOKEN_FACES)
            .map((id) => faceOf(id, input))
        : [],
    label: input.words.tokenLabel(key, value),
    removeLabel: input.words.chipRemove(key),
  };
}

/** One token per held filter, in the order they were added, then the one still being built. */
function tokensOf(
  query: SearchQuery,
  openField: SearchFilterField | null,
  input: SearchSheetInput,
): readonly TokenVm[] {
  const tokens: TokenVm[] = [];
  for (const held of query.searchFilters) {
    tokens.push(tokenOf(held.searchFilterField, held, input));
  }
  if (openField !== null && heldOf(query, openField) === null) {
    tokens.push(tokenOf(openField, null, input));
  }
  return tokens;
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
    readonly dropdownAction: DropdownAction;
  },
): DropdownRowVm {
  return {
    id: filterKey(filter),
    label: labelOf(filter, input),
    detail: shape.detail,
    glyph: null,
    face:
      filter.searchFilterField === SearchFilterField.Barber
        ? faceOf(filter.filterBarberIds[0] as BarberId, input)
        : null,
    checked: shape.checked,
    destructive: false,
    dropdownAction: shape.dropdownAction,
    searchFilterField: filter.searchFilterField,
    filter,
  };
}

function keyRow(
  field: SearchFilterField,
  query: SearchQuery,
  input: SearchSheetInput,
): DropdownRowVm {
  const held = heldOf(query, field);
  const note = field === SearchFilterField.Note;
  return {
    id: `FIELD:${field}`,
    label: note ? input.words.withNote : keyOf(field, input.words),
    detail: held === null || note ? null : valueOf(held, input),
    glyph: glyphOf(field),
    face: null,
    checked: null,
    destructive: false,
    // A note has no values: its key IS the filter.
    dropdownAction: note ? DropdownAction.AddValue : DropdownAction.OpenField,
    searchFilterField: field,
    filter: note ? SearchFilter.note() : null,
  };
}

/** The single values of a kind the window still offers, the held ones first. */
function valuesOf(
  field: SearchFilterField,
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): readonly SearchFilter[] {
  const held = heldOf(query, field);
  const out: SearchFilter[] = held === null ? [] : [...singleValues(held)];
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
      for (const id of offered.serviceIds) add(singleService(id));
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
  return out;
}

/** The keys a filter can be made of: those that still narrow, and the held ones. */
function keyRowsOf(
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): readonly DropdownRowVm[] {
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
        return (
          offered.hasNote && heldOf(query, SearchFilterField.Note) === null
        );
    }
  };
  return FIELD_ORDER.filter(
    (field) =>
      offers(field) ||
      (field !== SearchFilterField.Note && heldOf(query, field) !== null),
  ).map((field) => keyRow(field, query, input));
}

function calendarOf(
  query: SearchQuery,
  input: SearchSheetInput,
): DropdownCalendarVm | null {
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
): DropdownRowVm {
  const day = calendarMode === CalendarMode.Day;
  return {
    id: `CALENDAR:${calendarMode}`,
    label: day ? input.words.pickDay : input.words.pickRange,
    detail: null,
    // No glyph: it lines up with the presets above it, words all.
    glyph: null,
    face: null,
    checked: null,
    destructive: false,
    dropdownAction: day ? DropdownAction.PickDay : DropdownAction.PickRange,
    searchFilterField: SearchFilterField.When,
    filter: null,
  };
}

/** The open key's values: ✓ on the held ones, the typed text narrowing them. */
function valuesDropdown(
  field: SearchFilterField,
  offered: SearchSuggestions,
  query: SearchQuery,
  input: SearchSheetInput,
): SearchDropdownVm {
  const calendar = calendarOf(query, input);
  if (calendar !== null) {
    return { dropdownMode: DropdownMode.Values, sections: [], calendar };
  }
  const held = heldOf(query, field);
  const text = input.dropdownText.trim();
  // A span replaces the held one and closes the key; a list kind toggles in place.
  const toggles = held !== null && field !== SearchFilterField.When;
  const rows = valuesOf(field, offered, query, input)
    .map((filter) =>
      valueRow(filter, input, {
        checked: held === null ? null : isHeldValue(filter, query),
        detail: null,
        dropdownAction: toggles
          ? DropdownAction.ToggleValue
          : DropdownAction.AddValue,
      }),
    )
    .filter((row) => namesText(row.label, text));
  if (field === SearchFilterField.When) {
    rows.push(
      calendarRow(CalendarMode.Day, input),
      calendarRow(CalendarMode.Range, input),
    );
  }
  const sections: DropdownSectionVm[] = [
    {
      id: `VALUES:${field}`,
      heading: keyOf(field, input.words),
      rows,
    },
  ];
  if (held !== null) {
    sections.push({
      id: 'REMOVE',
      heading: null,
      rows: [
        {
          id: `REMOVE:${field}`,
          label: input.words.removeFilter,
          detail: null,
          glyph: 'action.remove',
          face: null,
          checked: null,
          destructive: true,
          dropdownAction: DropdownAction.RemoveFilter,
          searchFilterField: field,
          filter: null,
        },
      ],
    });
  }
  return { dropdownMode: DropdownMode.Values, sections, calendar: null };
}

/**
 * The list under the field. With a key open, its values. With nothing typed,
 * the keys. With text typed, the values whose name holds it (each with its
 * key), then the keys it names — the rest leave, as in Mail and GitLab.
 */
function dropdownOf(
  query: SearchQuery,
  offered: SearchSuggestions,
  input: SearchSheetInput,
): SearchDropdownVm {
  if (input.openField !== null) {
    return valuesDropdown(input.openField, offered, query, input);
  }
  const text = input.dropdownText.trim();
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
    return {
      dropdownMode: DropdownMode.Fields,
      sections: [
        {
          id: 'FIELDS',
          heading: input.words.filterBy,
          rows: keys,
        },
      ],
      calendar: null,
    };
  }
  const matched: DropdownRowVm[] = [];
  for (const field of FIELD_ORDER) {
    for (const filter of valuesOf(field, bare, SearchQuery.empty(), input)) {
      if (matched.length === MATCHED_VALUES) break;
      if (isHeldValue(filter, query)) continue;
      const row = valueRow(filter, input, {
        checked: null,
        detail: keyOf(field, input.words),
        dropdownAction: DropdownAction.AddValue,
      });
      if (namesText(row.label, text)) matched.push(row);
    }
  }
  const sections: DropdownSectionVm[] = [];
  if (matched.length > 0) {
    sections.push({
      id: 'MATCHES',
      heading: input.words.matches,
      rows: matched,
    });
  }
  // Only the keys the text names stay («бръ» → Бръснар); the rest leave, so
  // typing narrows the list rather than standing beside it. Nothing named
  // is an empty list, which the field draws as closed.
  const namedKeys = keys.filter((row) => namesText(row.label, text));
  if (namedKeys.length > 0) {
    sections.push({
      id: 'FIELDS',
      heading: input.words.filterBy,
      rows: namedKeys,
    });
  }
  return { dropdownMode: DropdownMode.Matches, sections, calendar: null };
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

function recentsOf(input: SearchSheetInput): readonly RecentVm[] {
  return input.recents.map((query, index) => {
    const parts = [
      query.searchText.trim(),
      ...tokensOf(query, null, input).map((token) =>
        // A note's value («има») reads only beside its key; alone it is «С бележка».
        token.id === SearchFilterField.Note
          ? input.words.withNote
          : token.value,
      ),
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

/** The sheet, worded: the tokens and recents, the dropdown, and the cards under their days. */
export function searchSheetVm(input: SearchSheetInput): SearchSheetVm {
  const query = input.query;
  const read = SearchQuerySystem.read(query.searchText, input.callingCode);
  const tokens = tokensOf(query, input.openField, input);
  const idle = SearchQuery.isEmpty(query);
  const offered = SearchFilterSystem.suggestions(
    input.index,
    read,
    query.searchFilters,
    input.shopNow,
  );
  const dropdown = dropdownOf(query, offered, input);
  const glyph = searchGlyphOf(
    ClientQuerySystem.parse(query.searchText).clientQueryShape,
  );
  // A token being built already says what it waits for; the text says nothing.
  const building = tokens.some((token) => token.value === '');
  const placeholder = building
    ? ''
    : tokens.length > 0
      ? input.words.placeholderShort
      : input.words.placeholder;
  const phoneRow =
    read.queryPhone.phoneReadingKind === PhoneReadingKind.None
      ? null
      : input.words.phoneRow(
          PhoneSystem.formatDraft(
            `+${read.queryPhone.phoneReadingCandidates[0] as string}`,
            null,
          ).formatted,
        );
  const footnotes: string[] = [];
  if (input.capped) footnotes.push(input.words.truncated);
  if (input.stale) footnotes.push(input.words.stale);

  if (idle) {
    return {
      searchSheetState: SearchSheetState.Idle,
      glyph,
      placeholder,
      tokenPlaceholder: input.words.tokenPlaceholder,
      tokens,
      dropdown,
      recents: recentsOf(input),
      phoneRow,
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
    tokenPlaceholder: input.words.tokenPlaceholder,
    tokens,
    dropdown,
    recents: [],
    phoneRow,
    groups: groupsOf(visits, read, input),
    clearFilters:
      kept.length === 0 && query.searchFilters.length > 0
        ? input.words.clearFilters
        : null,
    footnotes,
  };
}
