import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  resource,
  signal,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  type CourseInput,
  EnrollmentStatus,
  LocalizedText,
  type PositionInput,
  PositionStatus,
  WorkplaceMode,
  ProgramInput,
  type ShopEventInput,
  WallTime,
} from '@core/components';
import type { Course, Position, ShopEvent, ShopLocation } from '@core/entities';
import type { ProgramSaveError } from '@core/errors';
import { type LocationId, Locale, Tag } from '@core/primitives';
import { LocationScopeSystem, ProgramsSystem } from '@core/systems';
import { shopNameOf } from '@creativo/features/shared/catalog';
import { SiteHeaderComponent } from '@creativo/features/shared/shell';
import { sameLocationIds } from '@creativo/infrastructure/firebase-app';
import {
  DEFAULT_LOCALE,
  loadedLanguage,
  localeFor,
  translateCodedError,
} from '@creativo/infrastructure/i18n';
import {
  UiButton,
  UiChoiceMenu,
  type UiChoiceOption,
  UiIcon,
  type UiIconName,
  UiModalSheet,
  type UiSegment,
  UiSegmentedControl,
  UiSwitch,
  UiTextField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  type UiCheckOption,
  UiCheckList,
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiNotice,
  UiPageActionBar,
  UiSectionHeader,
  UiSheetActionBar,
  UiSwipeAction,
  UiSwipeActions,
} from '@creativo/ui/patterns';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiPaddingDirective,
  UiReorderHandle,
  UiReorderList,
  type UiReorderMove,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { AdminProgramsStore, ProgramsTab } from '../admin-programs.store';

/** Which program the edit form is open on — the field `programEditing`, the
 *  ONLY source of these strings (Law 6). */
const ProgramEditing = {
  /** A careers position. */
  Position: 'POSITION',
  /** A course. */
  Course: 'COURSE',
  /** A shop event. */
  Event: 'EVENT',
} as const;
type ProgramEditing = (typeof ProgramEditing)[keyof typeof ProgramEditing];

type PositionEditing = {
  readonly programEditing: typeof ProgramEditing.Position;
  readonly source: Position | null;
};
type CourseEditing = {
  readonly programEditing: typeof ProgramEditing.Course;
  readonly source: Course | null;
};
type EventEditing = {
  readonly programEditing: typeof ProgramEditing.Event;
  readonly source: ShopEvent | null;
};
type Editing = PositionEditing | CourseEditing | EventEditing | null;

/** Where the handle's menu puts a row — the field `programPlace` (Law 6). */
const ProgramPlace = {
  /** First in the list. */
  Top: 'TOP',
  /** One place up. */
  Up: 'UP',
  /** One place down. */
  Down: 'DOWN',
  /** Last in the list. */
  Bottom: 'BOTTOM',
} as const;
type ProgramPlace = (typeof ProgramPlace)[keyof typeof ProgramPlace];

/** One row of the list in view: what it is called and the status it prints. */
type ProgramRow = {
  readonly id: string;
  readonly title: string;
  /** The catalogue key of the row's status word; an event prints none. */
  readonly statusKey: string | null;
  /**
   * The quick action behind the row — a role's status or a course's
   * enrolment turned over, an event started again from a copy — as
   * the word and glyph it shows; a course or an event has none.
   */
  readonly quick: QuickAction;
};

/** The word and glyph of a row's quick action. */
type QuickAction = {
  readonly labelKey: string;
  readonly icon: UiIconName;
};

/** Take an open role or course off the public pages. */
const QUICK_CLOSE: QuickAction = {
  labelKey: 'admin.programs.quick.close',
  icon: 'program.hide',
};
/** Put a closed (or upcoming) one on them. */
const QUICK_OPEN: QuickAction = {
  labelKey: 'admin.programs.quick.open',
  icon: 'program.show',
};
/** An event has no status: its quick action starts a new one from a copy. */
const QUICK_DUPLICATE: QuickAction = {
  labelKey: 'admin.programs.quick.duplicate',
  icon: 'program.duplicate',
};

/**
 * One translated field of the sheet: the form draws these in a loop, for
 * the language in view, so a kind of program with another translated field
 * — or a shop with another language — adds a row here and no markup.
 */
type TranslatedInput = {
  /** Names the field in test ids: `admin-<id>-<locale>`. */
  readonly id: string;
  readonly labelKey: string;
  readonly multiline: boolean;
  /** May the thing be saved without it (in every language). */
  readonly required: boolean;
  readonly text: WritableSignal<LocalizedText>;
};

/**
 * Each language under its OWN name — what its segment prints, whatever
 * language the page is read in: a translator looks for «English», not for
 * «английски». Keyed by the dictionary, so a new locale will not compile
 * without its name.
 */
const ENDONYM: Readonly<Record<Locale, string>> = {
  bg: 'Български',
  en: 'English',
};

/** One shop chip of the role form: the shop's id and the word it prints. */
type ShopChip = {
  readonly id: LocationId;
  readonly label: string;
};

/** The «Без конкретен салон» option's id — the form's blank location (`''` → `null`). */
const NO_SHOP = '';

/**
 * `/admin/programs` — the one place staff manage Positions/Courses/Events.
 * One page, one tab switcher (not three routes) since the three entities
 * share so much shape; list body is `ui-list-group`, status pickers are
 * segmented controls, and the create/edit surface is the house form sheet
 * (`ui-modal-sheet`, owner 2026-11-27): a large title, the shop's own
 * language first with the translation as a section, and the one answer —
 * «Запази» — in the dock. ✕ leaves without saving. Every word is the
 * catalogue's (`admin.programs.*`, OR-37).
 *
 * ORDER is not a field of the form: it is arranged in the list, as the
 * public pages show it (≙ `List` in edit mode with `.onMove`). «Подреди»
 * gives every row a handle — dragged, moved a place with the arrow keys,
 * or tapped for «Най-горе · Нагоре · Надолу · Най-долу» — and each move is
 * saved at once (`reorderPositions`, `reorderCourses`); «Готово» leaves.
 * A new position or course goes to the end of its list
 * (`ProgramsSystem.nextSortOrder`); an edit keeps the place it has. An
 * event's place is its date, so the events list is never arranged.
 *
 * The shops (OR-37, OR-42): an event is at one of the ACTIVE shops or at
 * none (`ui-choice-menu`, «Без конкретен салон» first), a role is open at
 * the shops its chips name or at every shop (none chosen). Both pickers
 * draw only on a known list with shops to tell apart
 * (`LocationScopeSystem.isMultiShop`) — or when the edited program holds a
 * stored shop the list does not: that id stays, as an extra option worded
 * hidden («Център (скрит)») or deleted («Изтрит салон») from one read of
 * it, and is never dropped silently. A hidden picker leaves the stored
 * value as it was.
 */
@Component({
  selector: 'lib-admin-programs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteHeaderComponent,
    TranslocoDirective,
    UiButton,
    UiCheckList,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiModalSheet,
    UiNotice,
    UiPaddingDirective,
    UiPageActionBar,
    UiReorderHandle,
    UiReorderList,
    UiSectionHeader,
    UiSegmentedControl,
    UiSheetActionBar,
    UiStack,
    UiSwipeAction,
    UiSwipeActions,
    UiSwitch,
    UiTextDirective,
    UiTextField,
    UiVisuallyHiddenDirective,
  ],
  providers: [AdminProgramsStore],
  templateUrl: './admin-programs.html',
  styleUrl: './admin-programs.css',
  host: { class: 'lib-admin-programs', 'data-testid': 'admin-programs-page' },
})
export class AdminPrograms {
  protected readonly store = inject(AdminProgramsStore);
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  /** The status dictionaries, for the segments — the template never spells a stored tag. */
  protected readonly PositionStatus = PositionStatus;
  protected readonly WorkplaceMode = WorkplaceMode;
  protected readonly EnrollmentStatus = EnrollmentStatus;
  /*
   * A status prints the catalogue's word for its stored tag —
   * `programs.status.position.<tag>`, `programs.status.enrollment.<tag>`
   * (pass E, E-17; translated by OR-53) — on the rows and on the segments.
   */
  /** The edit form's program kinds, for the template. */
  protected readonly ProgramEditing = ProgramEditing;
  /** The tabs, for the template's segments and `@case`s (never bare literals). */
  protected readonly ProgramsTab = ProgramsTab;

  protected readonly tab = signal<ProgramsTab>(ProgramsTab.Positions);
  protected readonly editing = signal<Editing>(null);
  /** The list is being arranged: rows show handles and do not open. */
  protected readonly arranging = signal(false);
  /** The row whose handle menu is open, by id. */
  protected readonly orderMenu = signal<string | null>(null);
  /** A row's quick change was refused: said under the list's tabs. */
  protected readonly quickFailed = signal(false);
  private readonly reorderList = viewChild(UiReorderList);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The last move could not be saved. */
  protected readonly orderFailed = signal(false);
  /** The last move in words, for a screen reader: «„Бръснар“ — място 2 от 5». */
  protected readonly orderAnnouncement = signal('');
  protected readonly ProgramPlace = ProgramPlace;

  /** A move just made and still being saved: the order as arranged, ahead of the stored one. */
  private readonly positionOrder = signal<readonly Position[] | null>(null);
  private readonly courseOrder = signal<readonly Course[] | null>(null);

  /** The lists the page draws: the arranged order while a move is saved, the stored one otherwise. */
  protected readonly positions = computed(
    () => this.positionOrder() ?? this.store.positions(),
  );
  protected readonly courses = computed(
    () => this.courseOrder() ?? this.store.courses(),
  );

  /** The list in view, as rows: each thing's title in the shop's language and its status. */
  protected readonly rows = computed((): readonly ProgramRow[] => {
    const locale = this.locale();
    const tab = this.tab();
    if (tab === ProgramsTab.Positions) {
      return this.positions().map((position) => ({
        id: position.id,
        title: position.title[locale],
        statusKey: `programs.status.position.${position.positionStatus}`,
        quick:
          position.positionStatus === PositionStatus.Open
            ? QUICK_CLOSE
            : QUICK_OPEN,
      }));
    }
    if (tab === ProgramsTab.Courses) {
      return this.courses().map((course) => ({
        id: course.id,
        title: course.title[locale],
        statusKey: `programs.status.enrollment.${course.enrollmentStatus}`,
        quick:
          course.enrollmentStatus === EnrollmentStatus.Open
            ? QUICK_CLOSE
            : QUICK_OPEN,
      }));
    }
    return this.store.events().map((event) => ({
      id: event.id,
      title: event.title[locale],
      statusKey: null,
      quick: QUICK_DUPLICATE,
    }));
  });

  /** The list's test id, by tab — written out, never built from a stored tag. */
  protected readonly listTestId = computed(() => {
    const tab = this.tab();
    return tab === ProgramsTab.Positions
      ? 'admin-positions-list'
      : tab === ProgramsTab.Courses
        ? 'admin-courses-list'
        : 'admin-events-list';
  });

  /** Is there an order to arrange: two or more positions or courses (an event's place is its date). */
  protected readonly canArrange = computed(() => {
    const tab = this.tab();
    if (tab === ProgramsTab.Positions) return this.positions().length > 1;
    if (tab === ProgramsTab.Courses) return this.courses().length > 1;
    return false;
  });

  /** The sheet is on its way out: it leaves the page once its close has finished. */
  protected readonly closing = signal(false);
  protected readonly saving = signal(false);
  /** The last save's refusals; `null` until a save is refused. */
  protected readonly saveRefusals = signal<readonly ProgramSaveError[] | null>(
    null,
  );

  // ── The sheet's languages ───────────────────────────────────────────────

  /**
   * The language the sheet's translated fields are shown in — ONE at a
   * time, so the form is as long with five languages as with one. Every
   * sheet opens on the shop's own.
   */
  protected readonly language = signal<Locale>(DEFAULT_LOCALE);
  protected readonly defaultLanguage = DEFAULT_LOCALE;
  /** A save was refused here for a missing translation: the fields say so. */
  protected readonly owedShown = signal(false);

  // Position fields
  protected readonly positionTitle = signal(LocalizedText.blank());
  protected readonly positionSummary = signal(LocalizedText.blank());
  protected readonly positionStatus = signal<PositionStatus>(
    PositionStatus.Open,
  );
  /** Where the role is worked. A remote one names no shop: the list goes. */
  protected readonly positionWorkplace = signal<WorkplaceMode>(
    WorkplaceMode.OnSite,
  );
  /** The shops list is drawn: there are shops to pick, and the role is not remote. */
  protected readonly positionShopsShown = computed(
    () =>
      this.shopsShown() && this.positionWorkplace() !== WorkplaceMode.Remote,
  );
  /**
   * «Във всички салони» is off: the role names its shops. Kept apart from
   * the ids, because the switch may be off with no shop chosen yet.
   */
  protected readonly shopsLimited = signal(false);
  /** A save was refused because no shop is chosen: the list says so. */
  protected readonly shopsOwedShown = signal(false);
  /** The shops the role names; empty with the list unlimited = every shop. */
  protected readonly positionShopIds = signal<readonly LocationId[]>([]);
  /**
   * The optional link's field is drawn: the thing has one, or the row that
   * adds one was tapped. One flag, since one sheet is open at a time.
   */
  protected readonly linkShown = signal(false);
  protected readonly positionApplyUrl = signal('');

  // Course fields
  protected readonly courseTitle = signal(LocalizedText.blank());
  protected readonly courseDescription = signal(LocalizedText.blank());
  protected readonly courseEnrollmentStatus = signal<EnrollmentStatus>(
    EnrollmentStatus.Open,
  );
  protected readonly courseStartsLabel = signal(LocalizedText.blank());
  protected readonly courseApplyUrl = signal('');

  // Event fields
  protected readonly eventTitle = signal(LocalizedText.blank());
  protected readonly eventDescription = signal(LocalizedText.blank());
  /** The shop wall clock as typed, `YYYY-MM-DDTHH:mm`. */
  protected readonly eventStartsAt = signal('');
  /** The menu's pick — a shop's id, or {@link NO_SHOP}. */
  protected readonly eventLocationId = signal<string>(NO_SHOP);
  protected readonly eventApplyUrl = signal('');
  /** Whether the «Салон» menu is open. */
  protected readonly eventShopMenu = signal(false);

  // ── The words ───────────────────────────────────────────────────────────

  /**
   * The language the catalogue has loaded, once it has: every word below is
   * built with `translate(…, lang)`, so no lookup inside a `computed` starts
   * a load.
   */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** The data language a shop's name is read in — `bg` for every language but `en`. */
  private readonly locale = computed(() => localeFor(this.loadedLang()));

  // ── The shops (OR-37, OR-42) ────────────────────────────────────────────

  /** The active shops as read; empty until they answer and on a failed read. */
  private readonly activeShops = computed((): readonly ShopLocation[] => {
    const shops = this.store.shops();
    return shops?.ok ? shops.value : [];
  });

  /**
   * The edited program's stored shops that the active list does not hold
   * (hidden or deleted), in stored order — `ProgramsSystem`'s answer
   * (`eventUnlistedShop`, `positionUnlistedShops`), only once the list is
   * known: an unread list proves nothing about a stored id.
   */
  private readonly unlistedIds = computed(
    (): readonly LocationId[] => {
      if (this.store.shops()?.ok !== true) return [];
      const editing = this.editing();
      if (editing?.programEditing === ProgramEditing.Event) {
        if (editing.source === null) return [];
        const id = ProgramsSystem.eventUnlistedShop(
          editing.source,
          this.activeShops(),
        );
        return id === null ? [] : [id];
      }
      if (editing?.programEditing === ProgramEditing.Position) {
        if (editing.source === null) return [];
        return ProgramsSystem.positionUnlistedShops(
          editing.source,
          this.activeShops(),
        );
      }
      return [];
    },
    { equal: sameLocationIds },
  );

  /** What the unlisted ids are: each read once by id (hidden → the shop, deleted → `null`). */
  private readonly unlistedShops = resource({
    params: () => {
      const ids = this.unlistedIds();
      return ids.length === 0 ? undefined : ids;
    },
    loader: ({ params }) => this.store.loadShops(params),
  });

  /** Is there a picker to draw: a known list with shops to tell apart, or a stored shop it does not hold. */
  protected readonly shopsShown = computed(
    () =>
      this.store.shops()?.ok === true &&
      (LocationScopeSystem.isMultiShop(this.activeShops().length) ||
        this.unlistedIds().length > 0),
  );

  /**
   * Every shop a picker offers — the event menu's options after «Без
   * конкретен салон», the role's chips after «Всеки салон»: the active ones,
   * then the edited program's unlisted ones.
   */
  protected readonly shopChoices = computed((): readonly ShopChip[] => {
    const lang = this.loadedLang();
    if (lang === null) return [];
    const locale = this.locale();
    const chips: ShopChip[] = [];
    for (const shop of this.activeShops()) {
      chips.push({ id: shop.id, label: shopNameOf(shop, locale) });
    }
    const read = this.unlistedShops.hasValue()
      ? this.unlistedShops.value()
      : null;
    for (const id of this.unlistedIds()) {
      const loaded = read?.get(id);
      chips.push({
        id,
        // Unread (still reading, or the read failed): the stored id itself,
        // claiming neither hidden nor deleted.
        label:
          loaded === undefined
            ? id
            : loaded === null
              ? this.transloco.translate('admin.programs.shopMissing', {}, lang)
              : this.transloco.translate(
                  'admin.programs.shopHidden',
                  { name: shopNameOf(loaded, locale) },
                  lang,
                ),
      });
    }
    return chips;
  });

  /** The event's «Салон» menu: «Без конкретен салон», then every shop choice. */
  protected readonly eventShopOptions = computed(
    (): readonly UiChoiceOption[] => {
      const lang = this.loadedLang();
      if (lang === null) return [];
      const options: UiChoiceOption[] = [
        {
          id: NO_SHOP,
          label: this.transloco.translate(
            'admin.programs.event.shopNone',
            {},
            lang,
          ),
          testId: 'admin-event-shop-none',
        },
      ];
      for (const choice of this.shopChoices()) {
        options.push({
          id: choice.id,
          label: choice.label,
          testId: `admin-event-shop-${choice.id}`,
        });
      }
      return options;
    },
  );

  /** What the menu's trigger reads: the picked option's word. */
  protected readonly eventShopLabel = computed(
    () =>
      this.eventShopOptions().find(
        (option) => option.id === this.eventLocationId(),
      )?.label ?? '',
  );

  /**
   * The refused save in words (OR-38): ONE refusal the catalogue words —
   * `errors.<errorCode>`, «Този салон вече не съществува. Избери друг.» —
   * prints as itself; several, or one without words, print the form's
   * generic line.
   */
  protected readonly saveError = computed((): string | null => {
    const refusals = this.saveRefusals();
    const lang = this.loadedLang();
    if (refusals === null || lang === null) return null;
    const generic = this.transloco.translate(
      'admin.programs.saveFailed',
      {},
      lang,
    );
    const [only] = refusals;
    if (refusals.length !== 1 || only === undefined) return generic;
    const worded = translateCodedError(this.transloco, only);
    return worded === only.errorCode ? generic : worded;
  });

  /**
   * What the sheet is called: the edited thing's own title in the shop's
   * language, or «Нова позиция» / «Нов курс» / «Ново събитие».
   */
  protected readonly sheetTitle = computed((): string => {
    const editing = this.editing();
    const lang = this.loadedLang();
    if (editing === null || lang === null) return '';
    if (editing.source !== null) return editing.source.title[this.locale()];
    const key =
      editing.programEditing === ProgramEditing.Position
        ? 'admin.programs.editor.newPosition'
        : editing.programEditing === ProgramEditing.Course
          ? 'admin.programs.editor.newCourse'
          : 'admin.programs.editor.newEvent';
    return this.transloco.translate(key, {}, lang);
  });

  /** The role's shops as the check list offers them. */
  protected readonly shopOptions = computed((): readonly UiCheckOption[] =>
    this.shopChoices().map((choice) => ({
      id: choice.id,
      label: choice.label,
      testId: `admin-position-shop-${choice.id}`,
    })),
  );

  /** What the list shows chosen: the shops named, or — open at every shop — all of them. */
  protected readonly shopsSelected = computed((): readonly string[] =>
    this.shopsLimited()
      ? this.positionShopIds()
      : this.shopChoices().map((choice) => choice.id),
  );

  /** «1 от 2» beside the head while only some shops are chosen. */
  protected readonly shopsSummary = computed((): string | null => {
    const lang = this.loadedLang();
    const count = this.positionShopIds().length;
    if (!this.shopsLimited() || count === 0 || lang === null) return null;
    return this.transloco.translate(
      'admin.programs.position.shopsCount',
      { count, total: this.shopChoices().length },
      lang,
    );
  });

  /** The translated fields of the kind of program in the sheet, in form order. */
  protected readonly translatedInputs = computed(
    (): readonly TranslatedInput[] => {
      switch (this.editing()?.programEditing) {
        case ProgramEditing.Position:
          return [
            {
              id: 'position-title',
              labelKey: 'admin.programs.field.title',
              multiline: false,
              required: true,
              text: this.positionTitle,
            },
            {
              id: 'position-summary',
              labelKey: 'admin.programs.position.summary',
              multiline: true,
              required: true,
              text: this.positionSummary,
            },
          ];
        case ProgramEditing.Course:
          return [
            {
              id: 'course-title',
              labelKey: 'admin.programs.field.title',
              multiline: false,
              required: true,
              text: this.courseTitle,
            },
            {
              id: 'course-description',
              labelKey: 'admin.programs.field.description',
              multiline: true,
              required: true,
              text: this.courseDescription,
            },
            {
              id: 'course-starts-label',
              labelKey: 'admin.programs.course.startsLabel',
              multiline: false,
              required: false,
              text: this.courseStartsLabel,
            },
          ];
        case ProgramEditing.Event:
          return [
            {
              id: 'event-title',
              labelKey: 'admin.programs.field.title',
              multiline: false,
              required: true,
              text: this.eventTitle,
            },
            {
              id: 'event-description',
              labelKey: 'admin.programs.field.description',
              multiline: true,
              required: true,
              text: this.eventDescription,
            },
          ];
        default:
          return [];
      }
    },
  );

  /** The languages the sheet still owes a translation in (`LocalizedText.owedLocales`). */
  protected readonly owedLanguages = computed((): readonly Locale[] =>
    LocalizedText.owedLocales(
      this.translatedInputs().map((input) => ({
        text: input.text(),
        required: input.required,
      })),
    ),
  );

  /**
   * The switcher's segments: every language of the dictionary under its own
   * name, a dot on each one still owed — once a save has been tried, so a
   * new sheet does not open covered in marks.
   */
  protected readonly languageSegments = computed((): readonly UiSegment[] => {
    const lang = this.loadedLang();
    const owed = this.owedShown() ? this.owedLanguages() : [];
    return Tag.values(Locale).map((locale) => ({
      id: locale,
      label: ENDONYM[locale],
      testId: `admin-language-${locale}`,
      ...(owed.includes(locale) && lang !== null
        ? {
            attention: this.transloco.translate(
              'admin.programs.language.owedMark',
              {},
              lang,
            ),
          }
        : {}),
    }));
  });

  /** More than one language to switch between: with one there is no switcher. */
  protected readonly manyLanguages = Tag.values(Locale).length > 1;

  /** «Липсва превод на: английски, …» — the languages owed, in the reader's words. */
  protected readonly owedNotice = computed((): string | null => {
    const lang = this.loadedLang();
    const owed = this.owedLanguages();
    if (!this.owedShown() || owed.length === 0 || lang === null) return null;
    const names = owed
      .map((locale) =>
        this.transloco.translate(
          `admin.programs.language.name.${locale}`,
          {},
          lang,
        ),
      )
      .join(', ');
    return this.transloco.translate(
      'admin.programs.language.owed',
      { languages: names },
      lang,
    );
  });

  constructor() {
    this.transloco
      .selectTranslate('admin.programs.documentTitle')
      .pipe(takeUntilDestroyed())
      .subscribe((title: string) => this.title.setTitle(title));
  }

  protected setTab(next: ProgramsTab): void {
    this.tab.set(next);
    this.closed();
    this.stopArranging();
  }

  protected startArranging(): void {
    this.arranging.set(true);
    this.orderFailed.set(false);
  }

  protected stopArranging(): void {
    this.arranging.set(false);
    this.orderMenu.set(null);
    this.orderAnnouncement.set('');
  }

  /** The handle's menu: a place by name, turned into the move it means. */
  protected placeRow(from: number, place: ProgramPlace, count: number): void {
    const to =
      place === ProgramPlace.Top
        ? 0
        : place === ProgramPlace.Up
          ? from - 1
          : place === ProgramPlace.Down
            ? from + 1
            : count - 1;
    // Through the list, so a pick from the menu glides as a drag does.
    this.reorderList()?.move(from, to);
  }

  /**
   * A row's quick action, by the list in view. A role's status or a
   * course's enrolment is turned over and saved at once — the live list
   * shows the new word when the store answers, and a refused save says so
   * with nothing changed. An event opens the editor on a COPY of itself:
   * nothing is written until that sheet's «Запази», which saves a new one.
   */
  protected async runQuick(id: string): Promise<void> {
    const tab = this.tab();
    this.quickFailed.set(false);
    if (tab === ProgramsTab.Positions) {
      const position = this.positions().find((entry) => entry.id === id);
      if (position === undefined) return;
      const saved = await this.store.togglePositionStatus(position);
      if (!saved.ok) this.quickFailed.set(true);
    } else if (tab === ProgramsTab.Courses) {
      const course = this.courses().find((entry) => entry.id === id);
      if (course === undefined) return;
      const saved = await this.store.toggleCourseEnrollment(course);
      if (!saved.ok) this.quickFailed.set(true);
    } else {
      const event = this.store.events().find((entry) => entry.id === id);
      if (event === undefined) return;
      this.startEditEvent(event);
      // The same fields, no source: the sheet is a new event's.
      this.editing.set({ programEditing: ProgramEditing.Event, source: null });
    }
  }

  /**
   * One move, however it was made: the list shows it at once, the changed
   * places are saved, and a refused save puts the stored order back and
   * says so.
   */
  protected async moveRow(move: UiReorderMove): Promise<void> {
    this.orderMenu.set(null);
    this.orderFailed.set(false);
    if (this.tab() === ProgramsTab.Positions) {
      const next = ProgramsSystem.moved(this.positions(), move.from, move.to);
      this.positionOrder.set(next);
      this.announceMove(next[move.to]?.title[this.locale()], move.to, next);
      const saved = await this.store.reorderPositions(next);
      if (this.positionOrder() === next) this.positionOrder.set(null);
      if (!saved.ok) this.orderFailed.set(true);
    } else if (this.tab() === ProgramsTab.Courses) {
      const next = ProgramsSystem.moved(this.courses(), move.from, move.to);
      this.courseOrder.set(next);
      this.announceMove(next[move.to]?.title[this.locale()], move.to, next);
      const saved = await this.store.reorderCourses(next);
      if (this.courseOrder() === next) this.courseOrder.set(null);
      if (!saved.ok) this.orderFailed.set(true);
    }
  }

  private announceMove(
    name: string | undefined,
    to: number,
    list: readonly unknown[],
  ): void {
    const lang = this.loadedLang();
    if (name === undefined || lang === null) return;
    this.orderAnnouncement.set(
      this.transloco.translate(
        'admin.programs.order.moved',
        { name, place: to + 1, count: list.length },
        lang,
      ),
    );
  }

  /**
   * A segmented control answers with the id it was handed; each is matched
   * back to its dictionary, so a stored tag is never a cast string.
   */
  protected pickTab(id: string): void {
    const next = Object.values(ProgramsTab).find((tab) => tab === id);
    if (next !== undefined) this.setTab(next);
  }

  /** The switch «Активна»: on is open, off is closed. */
  protected setPositionOpen(open: boolean): void {
    this.positionStatus.set(open ? PositionStatus.Open : PositionStatus.Closed);
  }

  /**
   * Remote hides the shops and the save drops them; the draft keeps what
   * was picked, so turning back to a shop role finds them again.
   */
  protected pickWorkplace(id: string): void {
    const next = Object.values(WorkplaceMode).find((tag) => tag === id);
    if (next === undefined) return;
    this.positionWorkplace.set(next);
    if (next === WorkplaceMode.Remote) this.shopsOwedShown.set(false);
  }

  protected pickEnrollmentStatus(id: string): void {
    const next = Object.values(EnrollmentStatus).find((tag) => tag === id);
    if (next !== undefined) this.courseEnrollmentStatus.set(next);
  }

  protected startCreate(): void {
    const tab = this.tab();
    if (tab === ProgramsTab.Positions) {
      this.fillPosition(ProgramInput.blankPosition());
      this.positionShopIds.set([]);
      this.shopsLimited.set(false);
      this.editing.set({
        programEditing: ProgramEditing.Position,
        source: null,
      });
    } else if (tab === ProgramsTab.Courses) {
      this.fillCourse(ProgramInput.blankCourse());
      this.editing.set({ programEditing: ProgramEditing.Course, source: null });
    } else {
      this.fillEvent(ProgramInput.blankShopEvent());
      this.editing.set({ programEditing: ProgramEditing.Event, source: null });
    }
    this.saveRefusals.set(null);
  }

  /** «＋ Добави линк»: the field takes the row's place, the cursor in it. */
  protected addLink(): void {
    this.linkShown.set(true);
    this.focusIn('[data-link-field]');
  }

  /** Puts the cursor in the sheet's first match, once it is drawn. */
  private focusIn(selector: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`.lib-admin-programs__form ${selector}`)
          ?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }

  /** A row tapped: its thing opens in the sheet. */
  protected openRow(id: string): void {
    const tab = this.tab();
    if (tab === ProgramsTab.Positions) {
      const position = this.positions().find((entry) => entry.id === id);
      if (position !== undefined) this.startEditPosition(position);
    } else if (tab === ProgramsTab.Courses) {
      const course = this.courses().find((entry) => entry.id === id);
      if (course !== undefined) this.startEditCourse(course);
    } else {
      const event = this.store.events().find((entry) => entry.id === id);
      if (event !== undefined) this.startEditEvent(event);
    }
  }

  protected startEditPosition(position: Position): void {
    this.fillPosition({ ...position, applyUrl: position.applyUrl ?? '' });
    // The stored scope, as stored — an edit never wipes it (OR-42).
    this.positionShopIds.set(position.locationIds);
    this.shopsLimited.set(position.locationIds.length > 0);
    this.editing.set({
      programEditing: ProgramEditing.Position,
      source: position,
    });
    this.saveRefusals.set(null);
  }

  protected startEditCourse(course: Course): void {
    this.fillCourse({
      ...course,
      startsLabel: course.startsLabel ?? ProgramInput.blankCourse().startsLabel,
      applyUrl: course.applyUrl ?? '',
    });
    this.editing.set({ programEditing: ProgramEditing.Course, source: course });
    this.saveRefusals.set(null);
  }

  protected startEditEvent(event: ShopEvent): void {
    this.fillEvent({
      ...event,
      // The shop wall clock as `<input type="datetime-local">` reads it
      // (`YYYY-MM-DDTHH:mm`) — the edit form's prefill (F4-11); parsing it
      // back is `ProgramsSystem`'s.
      startsAt: WallTime.toLocalIso(
        WallTime.of(event.localDate, event.startMinutes),
      ),
      locationId: event.locationId ?? NO_SHOP,
      applyUrl: event.applyUrl ?? '',
    });
    this.editing.set({ programEditing: ProgramEditing.Event, source: event });
    this.saveRefusals.set(null);
  }

  /** ✕, the scrim, a drag down: the sheet leaves and nothing is saved. */
  protected cancelEdit(): void {
    this.closing.set(true);
  }

  /** The sheet's close has finished: it leaves the page. */
  protected closed(): void {
    this.editing.set(null);
    this.closing.set(false);
    this.saveRefusals.set(null);
  }

  /**
   * The check list answered. Every shop chosen is stored as "every shop"
   * (`[]`, OR-42) — the ones opened later too; anything less is the shops
   * named, in the list's order. None chosen is kept as typed and refused
   * at the save.
   */
  protected pickShops(ids: readonly string[]): void {
    const choices = this.shopChoices();
    const picked = choices
      .filter((choice) => ids.includes(choice.id))
      .map((choice) => choice.id);
    const every = picked.length === choices.length;
    this.shopsLimited.set(!every);
    this.positionShopIds.set(every ? [] : picked);
    if (picked.length > 0) this.shopsOwedShown.set(false);
  }

  /** The switcher picked a language: the translated fields show it. */
  protected pickLanguage(id: string): void {
    const next = Tag.values(Locale).find((locale) => locale === id);
    if (next !== undefined) this.language.set(next);
  }

  /** A translated field typed in: the language in view takes the words. */
  protected typeText(input: TranslatedInput, event: Event): void {
    const language = this.language();
    const value = this.inputValue(event);
    input.text.update((text) => LocalizedText.with(text, language, value));
  }

  /** Is this field what the language in view still owes, now that a save has asked. */
  protected owes(input: TranslatedInput): boolean {
    if (!this.owedShown()) return false;
    const text = input.text();
    if (text[this.language()].trim().length > 0) return false;
    return (
      input.required ||
      Tag.values(Locale).some((locale) => text[locale].trim().length > 0)
    );
  }

  /**
   * «Копирай от български»: every field still blank in the language in
   * view starts from the shop's own words — a draft to translate over,
   * never over something already typed.
   */
  protected copyFromDefault(): void {
    const language = this.language();
    for (const input of this.translatedInputs()) {
      const text = input.text();
      if (text[language].trim().length > 0) continue;
      input.text.set(LocalizedText.with(text, language, text[DEFAULT_LOCALE]));
    }
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing) return;
    // A translation is owed: nothing is sent. The sheet turns to the first
    // language that owes one (staying put if this one does), marks what is
    // missing and puts the caret in it.
    const owed = this.owedLanguages();
    const [firstOwed] = owed;
    if (firstOwed !== undefined) {
      this.owedShown.set(true);
      this.saveRefusals.set(null);
      if (!owed.includes(this.language())) this.language.set(firstOwed);
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('[data-owed]')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    // A role limited to no shop at all: nothing is sent, the list says so.
    if (
      editing.programEditing === ProgramEditing.Position &&
      this.positionShopsShown() &&
      this.shopsLimited() &&
      this.positionShopIds().length === 0
    ) {
      this.shopsOwedShown.set(true);
      this.saveRefusals.set(null);
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('ui-check-list [role="checkbox"]')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.saving.set(true);
    this.saveRefusals.set(null);

    let refusals: readonly ProgramSaveError[] | null;
    if (editing.programEditing === ProgramEditing.Position) {
      const saved = await this.store.submitPosition({
        id: editing.source?.id ?? null,
        input: this.positionInput(),
      });
      refusals = saved.ok ? null : saved.error;
    } else if (editing.programEditing === ProgramEditing.Course) {
      const saved = await this.store.submitCourse({
        id: editing.source?.id ?? null,
        input: this.courseInput(),
      });
      refusals = saved.ok ? null : saved.error;
    } else {
      const saved = await this.store.submitEvent({
        id: editing.source?.id ?? null,
        input: this.eventInput(),
      });
      refusals = saved.ok ? null : saved.error;
    }

    this.saving.set(false);
    if (refusals === null) {
      this.closing.set(true);
    } else {
      this.saveRefusals.set(refusals);
    }
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Loads a form — a blank one to create, a stored one (absent optionals blank) to edit. */
  private fillPosition(input: PositionInput): void {
    this.openOn();
    this.positionTitle.set(input.title);
    this.positionSummary.set(input.summary);
    this.positionStatus.set(input.positionStatus);
    this.positionWorkplace.set(input.workplaceMode);
    this.positionApplyUrl.set(input.applyUrl);
    this.linkShown.set(input.applyUrl.trim() !== '');
  }

  private fillCourse(input: CourseInput): void {
    this.openOn();
    this.courseTitle.set(input.title);
    this.courseDescription.set(input.description);
    this.courseEnrollmentStatus.set(input.enrollmentStatus);
    this.courseStartsLabel.set(input.startsLabel);
    this.courseApplyUrl.set(input.applyUrl);
    this.linkShown.set(input.applyUrl.trim() !== '');
  }

  private fillEvent(input: ShopEventInput): void {
    this.openOn();
    this.eventTitle.set(input.title);
    this.eventDescription.set(input.description);
    this.eventStartsAt.set(input.startsAt);
    this.eventLocationId.set(input.locationId);
    this.eventApplyUrl.set(input.applyUrl);
    this.linkShown.set(input.applyUrl.trim() !== '');
    this.eventShopMenu.set(false);
  }

  /** Every sheet opens on the shop's own language, with nothing marked owed. */
  private openOn(): void {
    this.language.set(DEFAULT_LOCALE);
    this.owedShown.set(false);
    this.shopsOwedShown.set(false);
  }

  /**
   * The place a save keeps: the stored one on an edit, the end of the list
   * for a new position or course.
   */
  private placeOf(list: readonly { readonly sortOrder: number }[]): number {
    return (
      this.editing()?.source?.sortOrder ?? ProgramsSystem.nextSortOrder(list)
    );
  }

  /**
   * The role form as typed. Its scope is the chips' ids — the stored scope
   * on an edit until a chip changes it, `[]` (every shop) when none is
   * chosen (OR-42: an edit no longer wipes it, F4-8 retired).
   */
  private positionInput(): PositionInput {
    return {
      title: this.positionTitle(),
      summary: this.positionSummary(),
      workplaceMode: this.positionWorkplace(),
      locationIds: this.positionShopIds(),
      positionStatus: this.positionStatus(),
      applyUrl: this.positionApplyUrl(),
      sortOrder: this.placeOf(this.store.positions()),
    };
  }

  private courseInput(): CourseInput {
    return {
      title: this.courseTitle(),
      description: this.courseDescription(),
      enrollmentStatus: this.courseEnrollmentStatus(),
      startsLabel: this.courseStartsLabel(),
      applyUrl: this.courseApplyUrl(),
      sortOrder: this.placeOf(this.store.courses()),
    };
  }

  private eventInput(): ShopEventInput {
    return {
      title: this.eventTitle(),
      description: this.eventDescription(),
      startsAt: this.eventStartsAt(),
      locationId: this.eventLocationId(),
      applyUrl: this.eventApplyUrl(),
      sortOrder: this.editing()?.source?.sortOrder ?? 0,
    };
  }
}
