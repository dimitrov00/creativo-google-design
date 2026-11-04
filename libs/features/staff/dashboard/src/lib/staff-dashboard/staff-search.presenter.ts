import {
  DayBucket,
  MatchMode,
  PhoneReadingKind,
  type SearchFilter,
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
import { formatWallClock } from '@creativo/ui/wall-clock';
import { searchGlyphOf } from '../visit-editor/visit-client-row.presenter';
import {
  type ChipVm,
  type RecentVm,
  SearchSheetState,
  type SearchSheetVm,
  type SuggestionGroupVm,
  SuggestionGroupKind,
  type SuggestionVm,
} from './staff-search.vm';
import type { StaffSearchWords } from './staff-search.words';

/*
 * THE SEARCH SHEET, WORDED (Law 10). What matches, which filters can still
 * narrow, how the visits group under their days and what the numbers read as
 * are the systems' (`SearchFilterSystem`, `VisitListSystem.dayGroups`,
 * `PhoneSystem`); this words them — chips, suggestions, headings, the event
 * cards' matched lines — and marks the runs `TextMatchSystem` found.
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
  if (preset === SearchWhenPreset.Today) return input.words.today;
  if (preset === SearchWhenPreset.Tomorrow) return input.words.tomorrow;
  if (preset === SearchWhenPreset.ThisWeek) return input.words.thisWeek;
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

function chipsOf(
  query: SearchQuery,
  input: SearchSheetInput,
): readonly ChipVm[] {
  const chips: ChipVm[] = [];
  for (const held of query.searchFilters) {
    for (const filter of singleValues(held)) {
      const label = labelOf(filter, input);
      chips.push({
        id: filterKey(filter),
        label,
        removeLabel: input.words.chipRemove(label),
        filter,
      });
    }
  }
  return chips;
}

/** Is this single value already a chip of the query? */
function isChosen(filter: SearchFilter, chips: readonly ChipVm[]): boolean {
  const key = filterKey(filter);
  return chips.some((chip) => chip.id === key);
}

function offer(
  filter: SearchFilter,
  input: SearchSheetInput,
  chips: readonly ChipVm[],
): SuggestionVm | null {
  return isChosen(filter, chips)
    ? null
    : { id: filterKey(filter), label: labelOf(filter, input), filter };
}

function suggestionGroups(
  offered: SearchSuggestions,
  input: SearchSheetInput,
  chips: readonly ChipVm[],
): readonly SuggestionGroupVm[] {
  const present = <T>(items: readonly (T | null)[]): readonly T[] =>
    items.filter((item): item is T => item !== null);
  const groups: SuggestionGroupVm[] = [
    {
      suggestionGroupKind: SuggestionGroupKind.When,
      heading: null,
      suggestions: present(
        offered.whenPresets.map((preset) =>
          offer(SearchFilterSystem.whenOf(preset, input.shopNow), input, chips),
        ),
      ),
    },
    {
      suggestionGroupKind: SuggestionGroupKind.Status,
      heading: null,
      suggestions: present(
        offered.bookingStatuses.map((status) =>
          offer(singleStatus(status), input, chips),
        ),
      ),
    },
    {
      suggestionGroupKind: SuggestionGroupKind.Note,
      heading: null,
      suggestions: present([
        offered.hasNote
          ? offer(
              {
                searchFilterField: SearchFilterField.Note,
                filterHasNote: true,
              },
              input,
              chips,
            )
          : null,
      ]),
    },
    {
      suggestionGroupKind: SuggestionGroupKind.Barber,
      heading: input.words.barberGroup,
      suggestions: present(
        offered.barberIds.map((id) => offer(singleBarber(id), input, chips)),
      ),
    },
    {
      suggestionGroupKind: SuggestionGroupKind.Service,
      heading: input.words.serviceGroup,
      suggestions: present(
        offered.serviceIds.map((id) => offer(singleService(id), input, chips)),
      ),
    },
  ];
  return groups.filter((group) => group.suggestions.length > 0);
}

function recentsOf(input: SearchSheetInput): readonly RecentVm[] {
  return input.recents.map((query, index) => {
    const parts = [
      query.searchText.trim(),
      ...chipsOf(query, input).map((chip) => chip.label),
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

/** The sheet, worded: the chips and recents, the suggestions, and the cards under their days. */
export function searchSheetVm(input: SearchSheetInput): SearchSheetVm {
  const query = input.query;
  const read = SearchQuerySystem.read(query.searchText, input.callingCode);
  const chips = chipsOf(query, input);
  const idle = SearchQuery.isEmpty(query);
  const offered = SearchFilterSystem.suggestions(
    input.index,
    read,
    query.searchFilters,
    input.shopNow,
  );
  const suggestions = suggestionGroups(offered, input, chips);
  const glyph = searchGlyphOf(
    ClientQuerySystem.parse(query.searchText).clientQueryShape,
  );
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
      chips,
      recents: recentsOf(input),
      suggestions,
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
    chips,
    recents: [],
    suggestions,
    phoneRow,
    groups: groupsOf(visits, read, input),
    clearFilters:
      kept.length === 0 && chips.length > 0 ? input.words.clearFilters : null,
    footnotes,
  };
}
