import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { SearchQuery, type ShopNow } from '@core/components';
import type { Appointment } from '@core/entities';
import type { AppointmentId, TimeZone } from '@core/primitives';
import {
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
  UiButton,
  UiChip,
  UiModalSheet,
  UiSearchField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiSectionHeader, UiSheetHeadline } from '@creativo/ui/patterns';
import { guestLabelOf } from '../staff-dashboard/staff-day-guest.words';
import { searchSheetVm } from '../staff-dashboard/staff-search.presenter';
import {
  type RecentVm,
  SearchSheetState,
  type SuggestionVm,
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
 * THE SCHEDULE SEARCH SHEET — a Spotlight-style sheet (docs/designs/
 * staff-search-spotlight.md). The DS field pinned under the bar, with the
 * chosen filters as chips inside it; before anything is typed the recent
 * searches and the filters on offer; while typing the visits as event cards
 * under their days, the lines the query found marked.
 *
 * It owns the query (the field's text and the chips) and the device's
 * recents; the window it searches is the store's (`pool`, `searchCapped`,
 * `searchStale`, read by `ensureWindow` when the sheet opens). Every
 * decision — what matches, what can still narrow it, which day a card files
 * under — is a system's (`SearchFilterSystem`, `VisitListSystem.dayGroups`);
 * `searchSheetVm` words the answer.
 */
@Component({
  selector: 'lib-staff-search-sheet',
  imports: [
    UiButton,
    UiChip,
    UiForegroundStyleDirective,
    UiModalSheet,
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
  protected readonly VisitPerspective = VisitPerspective;
  protected readonly VisitListStyle = VisitListStyle;

  // ── The query ─────────────────────────────────────────────────────────

  /** What the field shows now. */
  protected readonly typed = signal('');
  /** The text the window is scanned for: `typed` after the debounce. */
  private readonly committed = signal('');
  /** The chips (a query with no text). */
  private readonly filters = signal<SearchQuery>(SearchQuery.empty());
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly query = computed(() =>
    SearchQuery.withText(this.filters(), this.committed()),
  );

  /** The field is focused: the head folds, the bar is told. */
  protected readonly focused = signal(false);
  protected readonly engaged = computed(
    () =>
      this.focused() ||
      this.typed().trim().length > 0 ||
      this.filters().searchFilters.length > 0,
  );

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
    });
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
  }

  // ── The field ─────────────────────────────────────────────────────────

  protected typeText(text: string): void {
    this.typed.set(text);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.committed.set(text);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** The text is the scan's right away (a chip or a recent was pressed). */
  private commitNow(text: string): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.typed.set(text);
    this.committed.set(text);
  }

  protected removeChip(id: string): void {
    const chip = this.vm().chips.find((held) => held.id === id);
    if (chip === undefined) return;
    this.filters.update((held) =>
      SearchQuery.withoutFilterValue(held, chip.filter),
    );
  }

  protected addSuggestion(suggestion: SuggestionVm): void {
    this.filters.update((held) =>
      SearchQuery.withFilter(held, suggestion.filter),
    );
  }

  protected clearFilters(): void {
    this.filters.set(SearchQuery.empty());
  }

  protected runRecent(recent: RecentVm): void {
    this.filters.set(SearchQuery.withText(recent.query, ''));
    this.commitNow(recent.query.searchText);
  }

  protected clearAllRecents(): void {
    this.recents.set([]);
    clearRecents(this.storage);
  }

  /** Return: the search is kept as a recent. */
  protected submit(): void {
    this.keepRecent();
  }

  private keepRecent(): void {
    const next = pushRecent(
      this.recents(),
      SearchQuery.withText(this.filters(), this.typed()),
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
    this.focused.set(false);
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
