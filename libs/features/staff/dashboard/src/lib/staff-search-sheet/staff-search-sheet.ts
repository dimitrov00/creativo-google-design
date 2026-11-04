import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  SearchFilter,
  SearchFilterField,
  SearchQuery,
  type ShopNow,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type LocalDate,
  Tag,
  type TimeZone,
} from '@core/primitives';
import {
  SearchFilterSystem,
  SearchIndexSystem,
  type SearchLabels,
  ZonedTimeSystem,
} from '@core/systems';
import {
  VisitList,
  VisitListStyle,
  VisitPerspective,
  type VisitLookup,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  UiAvatar,
  UiButton,
  UiChip,
  UiIcon,
  UiModalSheet,
  UiMonthPicker,
  UiSearchField,
} from '@creativo/ui/controls';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListRow,
  UiSectionHeader,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { guestLabelOf } from '../staff-dashboard/staff-day-guest.words';
import { searchSheetVm } from '../staff-dashboard/staff-search.presenter';
import {
  CalendarMode,
  SuggestAction,
  type SuggestionRowVm,
  type RecentVm,
  SearchSheetState,
} from '../staff-dashboard/staff-search.vm';
import { staffSearchWordsOf } from '../staff-dashboard/staff-search.words';
import { StaffDayStore } from '../staff-day.store';
import {
  clearRecents,
  loadRecents,
  pushRecent,
  saveRecents,
} from '../staff-search-recents';

/** The pause after the last keystroke before the window is scanned. */
const SEARCH_DEBOUNCE_MS = 80;

/** Until the shop's own zone is known the sheet reads days in UTC (a day's slack, as the window does). */
const UTC_ZONE: TimeZone = (() => {
  const checked = ZonedTimeSystem.checkZone('UTC');
  if (!checked.ok) throw new Error('UTC is not a time zone');
  return checked.value;
})();

/** The device's storage, or nothing where it is blocked (private windows, previews). */
function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * THE SCHEDULE SEARCH SHEET (docs/designs/staff-search-spotlight.md, its
 * filters keyed in staff-search-tokens.md, at the thumb since 2026-11-05).
 * ≙ iOS 26 Mail and Photos: the DS field on the sheet's floor with the
 * chosen filters as key │ value tokens inside it and the ✕ that ends the
 * search beside it; the keys over it as chips; what the typed text names,
 * or an open key's values, above the results. Before anything is typed the
 * recent searches; while typing the visits as event cards under their days,
 * the lines the query found marked.
 *
 * A pressed token PARKS the typed search (`heldText`): the text typed then
 * narrows the key's values, and the search comes back when the key closes.
 *
 * It owns the query (the field's text and the filters), the open key and the
 * device's recents; the window it searches is the store's (`pool`, `searchCapped`,
 * `searchStale`, read by `ensureWindow` when the sheet opens). Every
 * decision — what matches, what can still narrow it, which day a card files
 * under — is a system's (`SearchFilterSystem`, `VisitListSystem.dayGroups`);
 * `searchSheetVm` words the answer.
 */
@Component({
  selector: 'lib-staff-search-sheet',
  imports: [
    UiAvatar,
    UiButton,
    UiChip,
    UiForegroundStyleDirective,
    UiIcon,
    UiListRow,
    UiModalSheet,
    UiMonthPicker,
    UiScrollRow,
    UiSearchField,
    UiSectionHeader,
    UiSheetHeadline,
    UiStack,
    UiTextDirective,
    VisitList,
  ],
  templateUrl: './staff-search-sheet.html',
  styleUrl: './staff-search-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffSearchSheet {
  /** The catalogue as the visit rows read it (services, barbers, shops). */
  readonly catalog = input.required<VisitLookup>();
  /** A companion's own name, by account, once their profile is read. */
  readonly companionNames = input<Readonly<Record<string, string>>>({});
  /** «Клиент без име». */
  readonly unnamedClient = input.required<string>();
  /** The shop's dial code, digits only. */
  readonly callingCode = input.required<string>();
  /** The reader's locale (`en-GB`, `bg-BG`) for dates. */
  readonly locale = input.required<string>();

  protected readonly store = inject(StaffDayStore);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storage = deviceStorage();

  protected readonly SearchSheetState = SearchSheetState;
  protected readonly CalendarMode = CalendarMode;
  protected readonly VisitPerspective = VisitPerspective;
  protected readonly VisitListStyle = VisitListStyle;

  // ── The query ─────────────────────────────────────────────────────────

  /** What the field shows now. */
  protected readonly typed = signal('');
  /** The text the window is scanned for: `typed` after the debounce. */
  private readonly committed = signal('');
  /** The filters (a query with no text). */
  private readonly filters = signal<SearchQuery>(SearchQuery.empty());
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** The key whose values are listed — a token being built or pressed. */
  protected readonly openField = signal<SearchFilterField | null>(null);
  /** The search parked while a key is open; null while none is. */
  private readonly heldText = signal<string | null>(null);
  /** The month open over the values, and a span's first picked end. */
  private readonly calendarMode = signal<CalendarMode | null>(null);
  private readonly rangeStart = signal<LocalDate | null>(null);

  protected readonly query = computed(() =>
    SearchQuery.withText(this.filters(), this.heldText() ?? this.committed()),
  );

  private readonly field = viewChild(UiSearchField);

  protected readonly recents = signal<readonly SearchQuery[]>(
    loadRecents(this.storage),
  );

  // ── What it is worded from ────────────────────────────────────────────

  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  private translate(
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ): string {
    this.copyTable();
    return this.transloco.translate<string>(key, params);
  }
  protected readonly t = (key: string): string => this.translate(key);

  private readonly words = computed(() => {
    this.copyTable();
    return staffSearchWordsOf((key, params) => this.translate(key, params));
  });
  private readonly rowWords = computed(() => {
    this.copyTable();
    return visitWordsOf(
      (key, params) => this.translate(key, params),
      this.transloco.getActiveLang(),
      VisitPerspective.Staff,
    );
  });

  private readonly labels = computed<SearchLabels>(() => {
    const catalog = this.catalog();
    const companions = this.companionNames();
    return {
      clientNames: (visit) => clientNamesOf(visit, companions),
      serviceName: (id) => catalog.serviceName(id),
      barberName: (id) => catalog.barberName(id),
    };
  });

  /** The window folded once, whenever it is replaced — never per keystroke. */
  private readonly index = computed(() =>
    SearchIndexSystem.build(this.store.pool(), this.labels()),
  );

  private readonly shopNow = computed<ShopNow>(
    () =>
      this.store.shopNow() ??
      ZonedTimeSystem.shopNow(this.store.nowUtcMs(), this.zone()),
  );
  private readonly zone = computed<TimeZone>(
    () => this.store.zone() ?? UTC_ZONE,
  );

  protected readonly vm = computed(() => {
    const labels = this.labels();
    const shopNowAt = this.store.shopNowAt();
    return searchSheetVm({
      query: this.query(),
      pool: this.store.pool(),
      index: this.index(),
      recents: this.recents(),
      shopNow: this.shopNow(),
      timeZone: this.zone(),
      shopNowAt: (visit) => shopNowAt(visit.locationId),
      locale: this.locale(),
      callingCode: this.callingCode(),
      lookup: this.catalog(),
      rowWords: this.rowWords(),
      words: this.words(),
      clientNames: labels.clientNames,
      unnamedClient: this.unnamedClient(),
      capped: this.store.searchCapped(),
      stale: this.store.searchStale(),
      openField: this.openField(),
      typedText: this.typed(),
      calendarMode: this.calendarMode(),
      rangeStart: this.rangeStart(),
    });
  });

  /** Escape closes the month, then the open key, before it reaches the sheet. */
  protected readonly escapeClaimed = computed(
    () => this.calendarMode() !== null || this.openField() !== null,
  );

  /** The pressed token wears the ring while its values are open. */
  protected readonly activeToken = computed(() => {
    const field = this.openField();
    return field !== null && this.heldFilter(field) ? field : null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
    // Spotlight's grammar: the sheet opens on the caret, the keys over it.
    // One frame on: the sheet hands its surface the focus in the frame after
    // it opens (`UiSheetBehavior`), and the field must come after that.
    afterNextRender(() => requestAnimationFrame(() => this.field()?.focus()));
  }

  // ── The field ─────────────────────────────────────────────────────────

  protected typeText(text: string): void {
    this.typed.set(text);
    // With a key open the text narrows its values, at once; the search is parked.
    if (this.openField() !== null) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.committed.set(text);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** The text is the scan's right away (a value or a recent was pressed). */
  private commitNow(text: string): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.typed.set(text);
    this.committed.set(text);
  }

  private heldFilter(field: SearchFilterField): boolean {
    return this.filters().searchFilters.some(
      (held) => held.searchFilterField === field,
    );
  }

  /** A key opened: the search is parked and the text narrows the key's values. */
  private openKey(field: SearchFilterField): void {
    if (this.openField() === null) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.heldText.set(this.typed());
      this.typed.set('');
    }
    this.openField.set(field);
    this.calendarMode.set(null);
    this.rangeStart.set(null);
  }

  /** The key closed: the parked search comes back as it was. */
  private closeKey(): void {
    const held = this.heldText();
    this.openField.set(null);
    this.calendarMode.set(null);
    this.rangeStart.set(null);
    if (held === null) return;
    this.heldText.set(null);
    this.commitNow(held);
  }

  /** A token pressed opens its values; pressed again, it closes them. */
  protected activateToken(id: string): void {
    if (!Tag.has(SearchFilterField, id)) return;
    if (this.openField() === id) this.closeKey();
    else this.openKey(id);
  }

  /** Backspace on an empty field: the token being built goes, else the last filter. */
  protected removeToken(id: string): void {
    if (!Tag.has(SearchFilterField, id)) return;
    if (this.openField() === id && !this.heldFilter(id)) {
      this.closeKey();
      return;
    }
    this.filters.update((held) => SearchQuery.withoutFilter(held, id));
    if (this.openField() === id) this.closeKey();
  }

  /** Escape: the month first, then the open key; with neither it is the sheet's. */
  protected escape(): void {
    if (this.calendarMode() !== null) {
      this.calendarMode.set(null);
      this.rangeStart.set(null);
    } else {
      this.closeKey();
    }
  }

  protected pickRow(row: SuggestionRowVm): void {
    switch (row.suggestAction) {
      case SuggestAction.OpenField:
        // A key the typed text named («бръ» → Бръснар) takes the text with it.
        if (this.openField() === null && this.typed() !== '')
          this.commitNow('');
        this.openKey(row.searchFilterField);
        return;
      case SuggestAction.AddValue: {
        const filter = row.filter;
        if (filter === null) return;
        this.filters.update((held) => SearchQuery.withFilter(held, filter));
        // A key's value closes the key; a matched value took the typed text with it.
        if (this.openField() !== null) this.closeKey();
        else this.commitNow('');
        return;
      }
      case SuggestAction.ToggleValue: {
        const filter = row.filter;
        if (filter === null) return;
        this.filters.update((held) =>
          row.checked === true
            ? SearchQuery.withoutFilterValue(held, filter)
            : SearchQuery.withFilter(held, filter),
        );
        if (!this.heldFilter(row.searchFilterField)) this.closeKey();
        return;
      }
      case SuggestAction.RemoveFilter:
        this.filters.update((held) =>
          SearchQuery.withoutFilter(held, row.searchFilterField),
        );
        this.closeKey();
        return;
      case SuggestAction.PickDay:
        this.calendarMode.set(CalendarMode.Day);
        this.rangeStart.set(null);
        return;
      case SuggestAction.PickRange:
        this.calendarMode.set(CalendarMode.Range);
        this.rangeStart.set(null);
        return;
    }
  }

  /** A day pressed in the month: one day is the span; a span takes two presses. */
  protected pickDay(day: LocalDate): void {
    const start = this.rangeStart();
    if (this.calendarMode() === CalendarMode.Range && start === null) {
      this.rangeStart.set(day);
      return;
    }
    const when =
      this.calendarMode() === CalendarMode.Range && start !== null
        ? SearchFilterSystem.spanOf(start, day)
        : SearchFilter.when(day, day);
    this.filters.update((held) => SearchQuery.withFilter(held, when));
    this.closeKey();
  }

  protected clearFilters(): void {
    this.closeKey();
    this.filters.set(SearchQuery.empty());
  }

  protected runRecent(recent: RecentVm): void {
    this.closeKey();
    this.filters.set(SearchQuery.withText(recent.query, ''));
    this.commitNow(recent.query.searchText);
  }

  protected clearAllRecents(): void {
    this.recents.set([]);
    clearRecents(this.storage);
  }

  /** Return: with a key open, its first value; else the search is kept as a recent. */
  protected submit(): void {
    if (this.openField() !== null) {
      const first = this.vm().suggestions.sections[0]?.rows[0];
      if (first !== undefined) this.pickRow(first);
      return;
    }
    this.keepRecent();
  }

  private keepRecent(): void {
    const next = pushRecent(
      this.recents(),
      SearchQuery.withText(this.filters(), this.heldText() ?? this.typed()),
    );
    this.recents.set(next);
    saveRecents(this.storage, next);
  }

  /** ↓ from the field lands on the first thing to press, as the visit sheet's lists do. */
  protected focusFirst(event: KeyboardEvent): void {
    const first = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-search-focusable], lib-visit-list button',
    );
    if (first === null) return;
    event.preventDefault();
    first.focus();
  }

  // ── The cards ─────────────────────────────────────────────────────────

  /** A card pressed: the schedule goes to its day, the search is kept, the sheet closes. */
  protected openHit(id: AppointmentId): void {
    const visit = this.store.pool().find((held) => held.id === id);
    if (visit === undefined) return;
    this.keepRecent();
    this.store.goToDay(visit.localDate);
    this.close();
  }

  protected close(): void {
    this.closeKey();
    this.store.closeSearch();
  }
}

/** Every name a visit is findable by as a client: the contact, each guest, each read companion. */
function clientNamesOf(
  visit: Appointment,
  companions: Readonly<Record<string, string>>,
): readonly string[] {
  const names: string[] = [];
  if (visit.contactName) names.push(visit.contactName);
  for (const seat of visit.seats) {
    const guest = guestLabelOf(seat);
    if (guest !== null) names.push(guest);
    else if ('subjectUserId' in seat) {
      const companion = companions[seat.subjectUserId];
      if (companion !== undefined) names.push(companion);
    }
  }
  return names;
}
