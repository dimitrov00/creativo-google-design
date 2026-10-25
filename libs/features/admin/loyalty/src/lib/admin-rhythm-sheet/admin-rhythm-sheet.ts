import {
  ChangeDetectionStrategy,
  Component,
  type Signal,
  ViewEncapsulation,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  LocalizedText,
  StreakExcuse,
  StreakQualifier,
  StreakQualifierRule,
  StreakRule,
} from '@core/components';
import type { Service, ServiceCategory } from '@core/entities';
import {
  LocalDate,
  Locale,
  type ServiceCategoryId,
  type ServiceId,
  Tag,
} from '@core/primitives';
import type { CategoryGroup } from '@core/systems';
import { rhythmRuleUnits } from '@creativo/features/shared/visits';
import {
  UI_SHEET_HEADLINE,
  UiButton,
  UiChoiceMenu,
  UiCountStepper,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiModalSheet,
  UiMonthPicker,
  UiNotice,
  UiSearchField,
  UiSheetActionBar,
  UiStack,
  UiSwitch,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { AdminRhythmStore } from '../admin-rhythm.store';
import {
  type AdminRhythmContext,
  earnEveryOptions,
  excuseKey,
  onBreakOf,
  onBreakOptions,
  pauseDaysOptions,
  repairPerYearOptions,
  repairWindowOptions,
} from '../admin-rhythm/admin-rhythm.words';
import { loadedLanguage } from '@creativo/infrastructure/i18n';

/**
 * The five secondary editors (§2.6.1a) — the sheet's input `sheet`, the
 * ONLY source of these strings (Law 1). Values: external contract — the
 * host's `data-kind` attribute prints the sheet on screen, so the spelling
 * stays. (Named `RhythmSheet`: `AdminRhythmSheet` is this component.)
 */
export const RhythmSheet = {
  /** P2a: the services that count. */
  Services: 'services',
  /** P8: the protections. */
  Protections: 'protections',
  /** P9, P10: the excuses and the client's pause. */
  Excuses: 'excuses',
  /** P11, P12: after a miss. */
  AfterMiss: 'afterMiss',
  /** P13: a day of the admin's own. */
  Day: 'day',
} as const;
export type RhythmSheet = (typeof RhythmSheet)[keyof typeof RhythmSheet];

/**
 * One category of the catalogue with its services — what the services
 * sheet lists under a heading, and what the rule's sentence names its
 * counted services from (`CatalogSystem.byCategory`'s group).
 */
export type RhythmServiceGroup = CategoryGroup<ServiceCategory, Service>;

/**
 * P9's layout of the shop's excuses (§2.6.2): the shop's own cancellation
 * first, then the barber's absence, then a closure. A display rank only —
 * WHICH excuses are the shop's is `StreakRule.SHOP_EXCUSES`.
 */
const P9_SHOP_EXCUSE_RANK: readonly StreakExcuse[] = [
  StreakExcuse.StaffCancelled,
  StreakExcuse.BarberAbsence,
  StreakExcuse.ShopClosure,
];

const p9Rank = (excuse: StreakExcuse): number => {
  const rank = P9_SHOP_EXCUSE_RANK.indexOf(excuse);
  return rank < 0 ? P9_SHOP_EXCUSE_RANK.length : rank;
};

/** One service as the services sheet lists it. */
interface ServiceRow {
  readonly id: ServiceId;
  readonly name: string;
}

interface ServiceGroupVm {
  readonly id: ServiceCategoryId;
  readonly name: string;
  readonly services: readonly ServiceRow[];
}

let sequence = 0;

/**
 * THE PAGE'S SHEETS (client-card revision 3 §2.6.1a, §3.17): a routed page
 * has no page stack, so a secondary editor is a `ui-modal-sheet` — ONE
 * component with a `@switch` on its kind. Each edits the page's DRAFT
 * through the SAME store (the page's provider), never the rule: its dock
 * holds one «Готово» that closes it; ✕, the scrim and Escape close it the
 * same way, since there is nothing to discard inside a sheet. The day
 * sheet has no dock: the day IS the answer.
 */
@Component({
  selector: 'lib-admin-rhythm-sheet',
  imports: [
    TranslocoDirective,
    UI_SHEET_HEADLINE,
    UiButton,
    UiChoiceMenu,
    UiCountStepper,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiModalSheet,
    UiMonthPicker,
    UiNotice,
    UiRadiusDirective,
    UiSearchField,
    UiSheetActionBar,
    UiStack,
    UiSwitch,
    UiTextDirective,
  ],
  templateUrl: './admin-rhythm-sheet.html',
  styleUrl: './admin-rhythm-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as the page is: the sheet lays out DS rows it holds. Every
  // selector in the stylesheet is `admin-rhythm-sheet`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'admin-rhythm-sheet-host',
    '[attr.data-kind]': 'shown()',
  },
})
export class AdminRhythmSheet {
  /** The sheet to show; `null` closes it. */
  readonly sheet = input<RhythmSheet | null>(null);
  /** The catalogue's services under their categories; `null` while unread. */
  readonly services = input<readonly RhythmServiceGroup[] | null>(null);
  /** The sheet has closed (its exit finished): the owner clears `sheet`. */
  readonly closed = output<void>();

  protected readonly store = inject(AdminRhythmStore);
  private readonly transloco = inject(TranslocoService);
  private readonly seq = ++sequence;
  protected readonly titleId = `admin-rhythm-sheet-${this.seq}-title`;

  protected readonly closing = signal(false);
  /** The sheets, for the template's `@case`s (never bare literals). */
  protected readonly RhythmSheet = RhythmSheet;

  /** The sheet on screen: kept through the exit, so the body does not vanish mid-animation. */
  protected readonly shown = linkedSignal<
    RhythmSheet | null,
    RhythmSheet | null
  >({
    source: this.sheet,
    computation: (sheet, previous) => sheet ?? previous?.value ?? null,
  });
  protected readonly open = computed(
    () => this.sheet() !== null && !this.closing(),
  );

  /** The services sheet's search. */
  protected readonly query = signal('');
  protected readonly searchFocused = signal(false);
  protected readonly searchEngaged = computed(
    () => this.searchFocused() || this.query().trim() !== '',
  );

  /** The sheets' menus, one open at a time. */
  protected readonly earnEveryMenu = signal(false);
  protected readonly pauseDaysMenu = signal(false);
  protected readonly onBreakMenu = signal(false);
  protected readonly repairWindowMenu = signal(false);
  protected readonly repairPerYearMenu = signal(false);

  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  protected readonly lang = computed(() => this.loadedLang() ?? Locale.Bg);

  protected readonly context: Signal<AdminRhythmContext | null> = computed(
    () => {
      const lang = this.loadedLang();
      const rule = this.store.rule();
      const days = this.store.days();
      const zone = this.store.zone();
      if (lang === null || rule === null || days === null || zone === null) {
        return null;
      }
      return {
        translate: (key, params) => this.transloco.translate(key, params, lang),
        lang,
        today: days.today,
        zone,
        rule,
      };
    },
  );

  protected readonly units = computed(() => {
    const context = this.context();
    return context === null
      ? null
      : rhythmRuleUnits(context.translate, context.lang);
  });

  /** The rule as the form holds it (`@let draft = current()` in the template). */
  protected readonly current = this.store.draft;
  private readonly draft = this.store.draft;

  /** The compact title in the bar, and the large one in the body. */
  protected readonly title = computed(() => {
    const context = this.context();
    const sheet = this.shown();
    if (context === null || sheet === null) return '';
    const t = context.translate;
    switch (sheet) {
      case RhythmSheet.Services:
        return t('admin.rhythm.sheet.services');
      case RhythmSheet.Protections:
        return t('admin.rhythm.protections.title');
      case RhythmSheet.Excuses:
        return t('admin.rhythm.excuses.title');
      case RhythmSheet.AfterMiss:
        return t('admin.rhythm.afterMiss.title');
      case RhythmSheet.Day:
        return t('admin.rhythm.effective.title');
    }
  });

  // ── Services ────────────────────────────────────────────────────────────

  /** The services the draft counts, by id. */
  private readonly chosen = computed((): readonly ServiceId[] => {
    const draft = this.draft();
    return draft.streakQualifier === StreakQualifier.Services
      ? draft.qualifierServiceIds
      : [];
  });

  protected readonly chosenServices = computed(
    (): ReadonlySet<ServiceId> => new Set(this.chosen()),
  );

  /** The catalogue's groups in the language, the search applied; a group with no match is left out. */
  protected readonly serviceGroups = computed(
    (): readonly ServiceGroupVm[] | null => {
      const groups = this.services();
      if (groups === null) return null;
      const locale = Tag.or(Locale, this.lang(), Locale.Bg);
      const query = this.query().trim().toLocaleLowerCase(locale);
      return groups
        .map((group) => ({
          id: group.category.id,
          name: LocalizedText.pick(group.category.name, locale),
          services: group.services
            .map((service) => ({
              id: service.id,
              name: LocalizedText.pick(service.name, locale),
            }))
            .filter(
              (service) =>
                query === '' ||
                service.name.toLocaleLowerCase(locale).includes(query),
            ),
        }))
        .filter((group) => group.services.length > 0);
    },
  );

  /** A service in or out of the list; the last one chosen stays (`StreakQualifierRule.toggleService`). */
  protected toggleService(id: ServiceId): void {
    const next = StreakQualifierRule.toggleService(this.chosen(), id);
    this.store.patch({ qualifier: StreakQualifierRule.services(next) });
  }

  // ── Protections ─────────────────────────────────────────────────────────

  protected readonly earnEveryOptions = computed(() =>
    this.withContext((context) => earnEveryOptions(context), []),
  );
  protected readonly earnEveryLabel = computed(
    () =>
      this.earnEveryOptions().find(
        (option) => option.id === String(this.draft().protectionsEarnEvery),
      )?.label ?? '',
  );

  // ── Excuses and the client's pause ──────────────────────────────────────

  /** P9's order (§2.6.2): the shop's excuses first, in P9's rank, then the days off. */
  protected readonly excuses: readonly StreakExcuse[] = [
    ...[...StreakRule.SHOP_EXCUSES].sort((a, b) => p9Rank(a) - p9Rank(b)),
    ...StreakRule.EXCUSES.filter(
      (excuse) => !StreakRule.SHOP_EXCUSES.includes(excuse),
    ),
  ];

  protected excused(excuse: StreakExcuse): boolean {
    return this.draft().excuses.includes(excuse);
  }

  /** «shopClosure» — an excuse's key and test-id word. */
  protected excuseKey(excuse: StreakExcuse): string {
    return excuseKey(excuse);
  }

  /** One of the shop's excuses is off (`StreakRule.coversShopExcuses`): the client will lose the rhythm through the shop's fault. */
  protected readonly shopExcuseOff = computed(
    () => !StreakRule.coversShopExcuses(this.draft().excuses),
  );

  protected setExcuse(excuse: StreakExcuse, on: boolean): void {
    const held = this.draft().excuses;
    this.store.patch({
      excuses: on
        ? [...held, excuse]
        : held.filter((other) => other !== excuse),
    });
  }

  protected readonly pauseDaysOptions = computed(() =>
    this.withContext((context) => pauseDaysOptions(context), []),
  );
  protected readonly pauseDaysLabel = computed(
    () =>
      this.context()?.rule.days(this.draft().clientPauseMaxDaysPerYear) ?? '',
  );

  // ── After a miss ────────────────────────────────────────────────────────

  protected readonly onBreakOptions = computed(() =>
    this.withContext((context) => onBreakOptions(context), []),
  );
  /** The menu's id for what a miss does: the `StreakOnBreak` member itself. */
  protected readonly onBreakChoice = computed(() => this.draft().onBreak);
  protected readonly onBreakLabel = computed(
    () =>
      this.onBreakOptions().find((option) => option.id === this.onBreakChoice())
        ?.label ?? '',
  );

  protected pickOnBreak(id: string): void {
    this.store.patch({ onBreak: onBreakOf(id) });
  }
  protected readonly repairWindowOptions = computed(() =>
    this.withContext((context) => repairWindowOptions(context), []),
  );
  protected readonly repairWindowLabel = computed(
    () => this.context()?.rule.days(this.draft().repairWindowDays) ?? '',
  );
  protected readonly repairPerYearOptions = computed(() =>
    this.withContext((context) => repairPerYearOptions(context), []),
  );
  protected readonly repairPerYearLabel = computed(
    () =>
      this.repairPerYearOptions().find(
        (option) => option.id === String(this.draft().repairPerYear),
      )?.label ?? '',
  );

  // ── The day ─────────────────────────────────────────────────────────────

  /**
   * A day the month picker handed back — a `LocalDate` of a cell it built
   * from the calendar; the sheet closes once it lands.
   */
  protected pickDay(day: LocalDate): void {
    this.store.setEffectiveFrom(day);
    this.requestClose();
  }

  // ── Open and close ──────────────────────────────────────────────────────

  /** ✕, the scrim, Escape, a drag, «Готово», a picked day: the exit starts. */
  protected requestClose(): void {
    if (!this.open()) return;
    this.closing.set(true);
  }

  /** The exit finished: the owner is told and clears `sheet`. */
  protected finishClose(): void {
    if (!this.closing()) return;
    this.closing.set(false);
    this.query.set('');
    this.searchFocused.set(false);
    this.closed.emit();
  }

  protected text(value: number): string {
    return String(value);
  }

  private withContext<T>(
    read: (context: AdminRhythmContext) => T,
    fallback: T,
  ): T {
    const context = this.context();
    return context === null ? fallback : read(context);
  }
}
