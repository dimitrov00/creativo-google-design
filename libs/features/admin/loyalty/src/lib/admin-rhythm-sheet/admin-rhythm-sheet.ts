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
import { map, switchMap } from 'rxjs/operators';
import type { ServiceCategoryGroup } from '@creativo/application/catalog';
import {
  STREAK_EXCUSES,
  type StreakExcuse,
} from '@creativo/application/engagement';
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
  onBreakOptions,
  pauseDaysOptions,
  repairPerYearOptions,
  repairWindowOptions,
} from '../admin-rhythm/admin-rhythm.words';

/** The five secondary editors (§2.6.1a). */
export type AdminRhythmSheetKind =
  'services' | 'protections' | 'excuses' | 'afterMiss' | 'day';

/** The three excuses that are the shop's: switching one off is said. */
const SHOP_EXCUSES: readonly StreakExcuse[] = [
  'staffCancelled',
  'barberAbsence',
  'shopClosure',
];

/** One service as the services sheet lists it. */
interface ServiceRow {
  readonly id: string;
  readonly name: string;
}

interface ServiceGroupVm {
  readonly id: string;
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
  readonly kind = input<AdminRhythmSheetKind | null>(null);
  /** The catalogue's services under their categories; `null` while unread. */
  readonly services = input<readonly ServiceCategoryGroup[] | null>(null);
  /** The sheet has closed (its exit finished): the owner clears `kind`. */
  readonly closed = output<void>();

  protected readonly store = inject(AdminRhythmStore);
  private readonly transloco = inject(TranslocoService);
  private readonly seq = ++sequence;
  protected readonly titleId = `admin-rhythm-sheet-${this.seq}-title`;

  protected readonly closing = signal(false);
  /** The kind on screen: kept through the exit, so the body does not vanish mid-animation. */
  protected readonly shown = linkedSignal<
    AdminRhythmSheetKind | null,
    AdminRhythmSheetKind | null
  >({
    source: this.kind,
    computation: (kind, previous) => kind ?? previous?.value ?? null,
  });
  protected readonly open = computed(
    () => this.kind() !== null && !this.closing(),
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

  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  protected readonly lang = computed(() => this.loadedLang() ?? 'bg');

  protected readonly context: Signal<AdminRhythmContext | null> = computed(
    () => {
      const lang = this.loadedLang();
      const rule = this.store.rule();
      if (lang === null || rule === null) return null;
      return {
        translate: (key, params) => this.transloco.translate(key, params, lang),
        lang,
        today: this.store.days().today,
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
    const kind = this.shown();
    if (context === null || kind === null) return '';
    const t = context.translate;
    switch (kind) {
      case 'services':
        return t('admin.rhythm.sheet.services');
      case 'protections':
        return t('admin.rhythm.protections.title');
      case 'excuses':
        return t('admin.rhythm.excuses.title');
      case 'afterMiss':
        return t('admin.rhythm.afterMiss.title');
      case 'day':
        return t('admin.rhythm.effective.title');
    }
  });

  // ── Services ────────────────────────────────────────────────────────────

  protected readonly chosenServices = computed((): ReadonlySet<string> => {
    const qualifier = this.draft().qualifier;
    return new Set(qualifier.kind === 'services' ? qualifier.serviceIds : []);
  });

  /** The catalogue's groups in the language, the search applied; a group with no match is left out. */
  protected readonly serviceGroups = computed(
    (): readonly ServiceGroupVm[] | null => {
      const groups = this.services();
      if (groups === null) return null;
      const locale = this.lang() === 'en' ? 'en' : 'bg';
      const query = this.query().trim().toLocaleLowerCase(locale);
      return groups
        .map((group) => ({
          id: group.category.id.value,
          name: group.category.name.get(locale),
          services: group.services
            .map((service) => ({
              id: service.id.value,
              name: service.name.get(locale),
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

  /** A service in or out of the list; the last one chosen stays. */
  protected toggleService(id: string): void {
    const qualifier = this.draft().qualifier;
    const chosen = qualifier.kind === 'services' ? qualifier.serviceIds : [];
    const next = chosen.includes(id)
      ? chosen.length === 1
        ? chosen
        : chosen.filter((other) => other !== id)
      : [...chosen, id];
    this.store.patch({ qualifier: { kind: 'services', serviceIds: next } });
  }

  // ── Protections ─────────────────────────────────────────────────────────

  protected readonly earnEveryOptions = computed(() =>
    this.withContext((context) => earnEveryOptions(context), []),
  );
  protected readonly earnEveryLabel = computed(
    () =>
      this.earnEveryOptions().find(
        (option) => option.id === String(this.draft().protections.earnEvery),
      )?.label ?? '',
  );

  // ── Excuses and the client's pause ──────────────────────────────────────

  /** P9's order (§2.6.2): the shop's three first, then the days off. */
  protected readonly excuses: readonly StreakExcuse[] = [
    ...SHOP_EXCUSES,
    ...STREAK_EXCUSES.filter((excuse) => !SHOP_EXCUSES.includes(excuse)),
  ];

  protected excused(excuse: StreakExcuse): boolean {
    return this.draft().excuses.includes(excuse);
  }

  /** One of the shop's three excuses is off: the client will lose the rhythm through the shop's fault. */
  protected readonly shopExcuseOff = computed(() =>
    SHOP_EXCUSES.some((excuse) => !this.draft().excuses.includes(excuse)),
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
      this.context()?.rule.days(this.draft().clientPause.maxDaysPerYear) ?? '',
  );

  // ── After a miss ────────────────────────────────────────────────────────

  protected readonly onBreakOptions = computed(() =>
    this.withContext((context) => onBreakOptions(context), []),
  );
  protected readonly onBreakLabel = computed(
    () =>
      this.onBreakOptions().find((option) => option.id === this.draft().onBreak)
        ?.label ?? '',
  );
  protected readonly repairWindowOptions = computed(() =>
    this.withContext((context) => repairWindowOptions(context), []),
  );
  protected readonly repairWindowLabel = computed(
    () => this.context()?.rule.days(this.draft().repair.windowDays) ?? '',
  );
  protected readonly repairPerYearOptions = computed(() =>
    this.withContext((context) => repairPerYearOptions(context), []),
  );
  protected readonly repairPerYearLabel = computed(
    () =>
      this.repairPerYearOptions().find(
        (option) => option.id === String(this.draft().repair.perYear),
      )?.label ?? '',
  );

  // ── The day ─────────────────────────────────────────────────────────────

  protected pickDay(day: string): void {
    this.store.setEffectiveFrom(day);
    this.requestClose();
  }

  // ── Open and close ──────────────────────────────────────────────────────

  /** ✕, the scrim, Escape, a drag, «Готово», a picked day: the exit starts. */
  protected requestClose(): void {
    if (!this.open()) return;
    this.closing.set(true);
  }

  /** The exit finished: the owner is told and clears `kind`. */
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
