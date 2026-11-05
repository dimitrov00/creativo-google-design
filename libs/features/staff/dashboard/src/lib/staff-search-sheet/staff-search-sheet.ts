import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  LocalizedText,
  SearchFilter,
  SearchFilterField,
  SearchQuery,
  ServiceVariantPick,
  type ShopNow,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type LocalDate,
  Locale,
  type ServiceId,
  type ServiceVariantId,
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
  UiAvatarGroup,
  UiPersonTile,
  UiButton,
  UiChip,
  UiIcon,
  UiModalSheet,
  UiMonthPicker,
  UiSearchField,
} from '@creativo/ui/controls';
import { UiFlow, UiGrid, UiStack } from '@creativo/ui/layout';
import {
  ServiceCardComponent,
  type ServiceVm,
} from '@creativo/features/shared/catalog';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMarkedText,
  UiPageActionBar,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { guestLabelOf } from '../staff-dashboard/staff-day-guest.words';
import {
  type SearchServiceArt,
  searchSheetVm,
} from '../staff-dashboard/staff-search.presenter';
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
 * THE SCHEDULE SEARCH (docs/designs/staff-search-spotlight.md, its filters
 * keyed in staff-search-tokens.md, at the thumb and full screen since
 * 2026-11-05). ≙ iOS 26 Mail and Photos: a full-screen page whose own
 * bottom bar holds the DS capsule field and the ✕ that ends the search; the
 * chosen filters floating over the field as selected chips that say their
 * values; while the field has the focus, the free keys in a card over it;
 * the starters, what the typed text names, or an open key's values above the
 * results, under their keys, the typed run marked. Before anything is typed
 * the starters and the recent searches; while typing the visits as event
 * cards under their days, the lines the query found marked.
 *
 * A pressed filter PARKS the typed search (`heldText`): the text typed then
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
    UiAvatarGroup,
    UiPersonTile,
    UiButton,
    UiChip,
    UiFlow,
    UiGrid,
    ServiceCardComponent,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMarkedText,
    UiModalSheet,
    UiMonthPicker,
    UiPageActionBar,
    UiSearchField,
    UiSectionHeader,
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
  /** The catalogue's services (covers, variants) — the service grid's art. */
  readonly services = input<readonly ServiceVm[]>([]);
  /** A card pressed: the page opens that visit's sheet OVER the search, as the schedule does. */
  readonly visitPicked = output<AppointmentId>();

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

  /** The key whose values are listed — being picked, or a chosen filter pressed. */
  protected readonly openField = signal<SearchFilterField | null>(null);
  /** The texts taken as filters (Return or ✓), in the order taken; the query reads them before what is typed. */
  protected readonly committedTexts = signal<readonly string[]>([]);
  /** The set being picked for an open many-valued key, until «Приложи»; null for none ticked. */
  private readonly draft = signal<SearchFilter | null>(null);
  /** The search parked while a key is open; null while none is. */
  private readonly heldText = signal<string | null>(null);
  /** The month open over the values, and a span's first picked end. */
  private readonly calendarMode = signal<CalendarMode | null>(null);
  private readonly rangeStart = signal<LocalDate | null>(null);

  protected readonly query = computed(() =>
    SearchQuery.withText(
      this.filters(),
      [...this.committedTexts(), this.heldText() ?? this.committed()]
        .filter((text) => text.trim() !== '')
        .join(' '),
    ),
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

  /** The catalogue read once per change into lookups the presenter asks per tile. */
  private readonly serviceArt = computed<SearchServiceArt>(() => {
    this.copyTable();
    // The active language read at the edge as a Locale (exact match).
    const active = this.transloco.getActiveLang();
    const lang = Tag.has(Locale, active) ? active : Locale.Bg;
    const covers = new Map<ServiceId, string>();
    const variants = new Map<ServiceId, readonly ServiceVariantId[]>();
    const variantNames = new Map<string, string>();
    for (const service of this.services()) {
      if (service.coverSrc !== undefined)
        covers.set(service.id, service.coverSrc);
      variants.set(
        service.id,
        service.variants.map((variant) => variant.id),
      );
      for (const variant of service.variants) {
        variantNames.set(
          ServiceVariantPick.keyOf(
            ServiceVariantPick.of(service.id, variant.id),
          ),
          LocalizedText.pick(variant.name, lang),
        );
      }
    }
    return {
      coverSrc: (id) => covers.get(id) ?? null,
      variantsOf: (id) => variants.get(id) ?? [],
      variantName: (pick) =>
        variantNames.get(ServiceVariantPick.keyOf(pick)) ?? null,
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
      serviceArt: this.serviceArt(),
      rowWords: this.rowWords(),
      words: this.words(),
      clientNames: labels.clientNames,
      unnamedClient: this.unnamedClient(),
      capped: this.store.searchCapped(),
      stale: this.store.searchStale(),
      openField: this.openField(),
      typedText: this.typed(),
      draft: this.draft(),
      committedTexts: this.committedTexts(),
      calendarMode: this.calendarMode(),
      rangeStart: this.rangeStart(),
    });
  });

  /** The field has the focus — the card of keys shows only then (Photos). */
  private readonly focused = signal(false);
  /** Escape put the card away; typing or a new focus brings it back. */
  private readonly cardDismissed = signal(false);
  protected readonly cardOpen = computed(
    () =>
      this.focused() &&
      !this.cardDismissed() &&
      this.vm().suggestions.keys.length > 0,
  );

  /** Escape closes the month, then the open key, before it reaches the sheet. */
  protected readonly escapeClaimed = computed(
    () => this.calendarMode() !== null || this.openField() !== null,
  );

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

  protected focusChange(focused: boolean): void {
    this.focused.set(focused);
    this.cardDismissed.set(false);
  }

  protected typeText(text: string): void {
    this.typed.set(text);
    this.cardDismissed.set(false);
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
    // A many-valued key is picked as a set, from what it holds now.
    this.draft.set(
      SearchFilter.holdsMany(field)
        ? (this.filters().searchFilters.find(
            (held) => held.searchFilterField === field,
          ) ?? null)
        : null,
    );
  }

  /** The key closed: the parked search comes back as it was; a set not applied is let go. */
  private closeKey(): void {
    const held = this.heldText();
    this.openField.set(null);
    this.draft.set(null);
    this.calendarMode.set(null);
    this.rangeStart.set(null);
    if (held === null) return;
    this.heldText.set(null);
    this.commitNow(held);
  }

  /** A filter chip pressed opens its values; pressed again, it closes them. */
  protected activateFilter(field: SearchFilterField): void {
    if (this.openField() === field) this.closeKey();
    else this.openKey(field);
  }

  /** Escape: the month first, then the open key, then the card; with none it is the sheet's. */
  protected escape(): void {
    if (this.calendarMode() !== null) {
      this.calendarMode.set(null);
      this.rangeStart.set(null);
    } else if (this.openField() !== null) {
      this.closeKey();
    } else {
      this.cardDismissed.set(true);
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
        // A many-valued key is ticked as a set and applied once (owner,
        // 2026-11-05: "toggle for multiple selection plus apply when done").
        const filter = row.filter;
        if (filter === null) return;
        this.draft.update((draft) =>
          row.checked === true
            ? draft === null
              ? null
              : SearchFilter.subtract(draft, filter)
            : draft === null
              ? filter
              : SearchFilter.merge(draft, filter),
        );
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
    this.committedTexts.set([]);
  }

  protected runRecent(recent: RecentVm): void {
    this.closeKey();
    this.committedTexts.set([]);
    this.filters.set(SearchQuery.withText(recent.query, ''));
    this.commitNow(recent.query.searchText);
  }

  protected clearAllRecents(): void {
    this.recents.set([]);
    clearRecents(this.storage);
  }

  /**
   * Return or the ✓: the typed text is TAKEN as a filter (Mail's «Subject
   * contains …» token, owner 2026-11-05) — a chip before the filters — and
   * the field is free for the next word or a key. The search is kept.
   */
  protected commitText(): void {
    const text = this.typed().trim();
    if (text === '' || this.openField() !== null) return;
    this.committedTexts.update((texts) => [...texts, text]);
    this.commitNow('');
    this.keepRecent();
  }

  /** A taken text pressed: back into the field to be changed (what is typed there now is taken first). */
  protected editText(at: number): void {
    const texts = this.committedTexts();
    const text = texts[at];
    if (text === undefined) return;
    const current = this.typed().trim();
    this.committedTexts.set([
      ...texts.filter((_, index) => index !== at),
      ...(current === '' ? [] : [current]),
    ]);
    this.commitNow(text);
    this.field()?.focus();
  }

  /** «Приложи»: the set picked replaces the key's filter where it stands (none ticked takes it off). */
  protected apply(): void {
    const field = this.openField();
    if (field === null) return;
    this.filters.update((held) =>
      SearchQuery.withFilterReplaced(held, field, this.draft()),
    );
    this.closeKey();
  }

  /** Return: a set being picked is applied; with a key open, its first value; else the search is kept as a recent. */
  protected submit(): void {
    if (this.vm().suggestions.apply !== null) {
      this.apply();
      return;
    }
    if (this.openField() !== null) {
      const first = this.vm().suggestions.sections[0]?.rows[0];
      if (first !== undefined) this.pickRow(first);
      return;
    }
    if (this.typed().trim() !== '') {
      this.commitText();
      return;
    }
    this.keepRecent();
  }

  private keepRecent(): void {
    const next = pushRecent(
      this.recents(),
      SearchQuery.withText(
        this.filters(),
        [...this.committedTexts(), this.heldText() ?? this.typed()]
          .filter((text) => text.trim() !== '')
          .join(' '),
      ),
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

  /**
   * A card pressed: its visit's sheet opens over the search (owner,
   * 2026-11-05: "open the event details sheet just like in the staff
   * view"), and closing it comes back to these results, as a message opened
   * from Mail's search does. The schedule behind moves to the visit's day,
   * whose row the sheet is drawn from; the search is kept as a recent.
   */
  protected openHit(id: AppointmentId): void {
    const visit = this.store.pool().find((held) => held.id === id);
    if (visit === undefined) return;
    this.keepRecent();
    this.store.goToDay(visit.localDate);
    this.visitPicked.emit(id);
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
