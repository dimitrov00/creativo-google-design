import {
  ChangeDetectionStrategy,
  Component,
  type Signal,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  LocalizedText,
  StreakInterval,
  StreakQualifier,
  StreakQualifierRule,
  StreakRuleDirection,
} from '@core/components';
import { StreakPublishErrorCode } from '@core/primitives';
import {
  type RhythmServiceGroup,
  rhythmServiceGroupsOf,
} from './rhythm-service-groups';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import {
  type RhythmRuleUnits,
  rhythmRuleUnits,
} from '@creativo/features/shared/visits';
import {
  UiAlert,
  type UiAlertAction,
  UiBadge,
  UiButton,
  UiCard,
  UiChoiceMenu,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiMetric,
  UiNotice,
  UiPageActionBar,
  UiSectionHeader,
  UiSkeleton,
  UiSlider,
  UiStack,
  UiStreakTrack,
  UiSwitch,
  UiToast,
  UiUnitField,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import type { AdminRhythmLeaving } from '../admin-rhythm.guard';
import { RHYTHM_PREVIEW_CAP } from '../admin-rhythm.preview';
import {
  type AdminRhythmPatch,
  type AdminRhythmRefusal,
  type AdminRhythmSaveOutcome,
  AdminRhythmStore,
  fixedInterval,
  isPublishRefusal,
  personalInterval,
} from '../admin-rhythm.store';
import {
  AdminRhythmSheet,
  type AdminRhythmSheetKind,
} from '../admin-rhythm-sheet/admin-rhythm-sheet';
import {
  type AdminRhythmContext,
  type AdminRhythmHistoryRow,
  type AdminRhythmPreviewWords,
  afterMissRow,
  daysOf,
  effectiveOptions,
  effectiveReading,
  excusesRow,
  graceMarks,
  historyRow,
  inForceCapsule,
  intervalOptions,
  invalidNotice,
  previewWords,
  protectionsRow,
  qualifierOptions,
  riskLeadOptions,
  ruleDigest,
  samplePeriods,
  sampleLabel,
  sampleUnit,
  servicesCount,
  shortDay,
  toleranceExample,
  toleranceMarks,
  toleranceReadout,
  upcomingLine,
  weekMarks,
  weeksOf,
} from './admin-rhythm.words';

/** A word the page prints that is not a bare key: built once the catalogue has loaded. */
type Translate = AdminRhythmContext['translate'];

/** What «Запази» or a leave asks first, as `ui-alert`. */
type Confirmation = 'stricter' | 'switchOff' | 'switchOn' | 'discard';

/** The receipt, or a refusal said in passing: ONE toast; a new one replaces the last. */
interface Toast {
  readonly label: string;
  /** «Отмени» calls off the version that waits (a looser or neutral change only). */
  readonly undo: boolean;
}

let sequence = 0;

/**
 * «РИТЪМ», THE ADMIN PAGE (client-card revision 3 §2.6, §3.17): a routed
 * page where the rhythm's rule is managed — on or off, what counts, the
 * interval, the grace — and the eleven quieter parameters one tap away
 * behind three value rows. Built only from DS controls over
 * `AdminRhythmStore`, which the page provides and its sheets read.
 *
 * THE FORM IS A DRAFT (§2.6.4): nothing is written until «Запази». The
 * dock appears only when the draft differs from the rule in force and is
 * valid; leaving with a draft asks first, through the route's guard and
 * `confirmLeave()`.
 */
@Component({
  selector: 'lib-admin-rhythm',
  imports: [
    RouterLink,
    TranslocoDirective,
    AdminRhythmSheet,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGrid,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiMetric,
    UiNotice,
    UiPaddingDirective,
    UiPageActionBar,
    UiRadiusDirective,
    UiSectionHeader,
    UiSkeleton,
    UiSlider,
    UiStack,
    UiStreakTrack,
    UiSwitch,
    UiTextDirective,
    UiToast,
    UiUnitField,
  ],
  providers: [AdminRhythmStore],
  templateUrl: './admin-rhythm.html',
  styleUrl: './admin-rhythm.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as the visit editor is: the page lays out DS rows it holds
  // (a value under its label at 330), which emulated scoping cannot reach.
  // Every selector in the stylesheet is `admin-rhythm`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'admin-rhythm-host',
    '[attr.data-state]': 'state()',
  },
})
export class AdminRhythm implements AdminRhythmLeaving {
  protected readonly store = inject(AdminRhythmStore);
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CATALOG_PORTS, { optional: true });

  private readonly seq = ++sequence;

  // ── The sheets, the alert, the toast ────────────────────────────────────

  /** The sheet that is open; `null` for none. */
  protected readonly sheetKind = signal<AdminRhythmSheetKind | null>(null);
  /** The question on screen; `null` for none. */
  protected readonly confirm = signal<Confirmation | null>(null);
  protected readonly toast = signal<Toast | null>(null);
  /** «Отмени предстоящата промяна»: armed by the first tap, done by the second. */
  protected readonly withdrawArmed = signal(false);
  /** The menus on the page, one open at a time. */
  protected readonly qualifierMenu = signal(false);
  protected readonly intervalMenu = signal(false);
  protected readonly riskLeadMenu = signal(false);
  protected readonly effectiveMenu = signal(false);

  /** The guard's question, waiting for the admin's answer. */
  private leaving: ((answer: boolean) => void) | null = null;
  /** Whether the receipt may offer «Отмени»: a stricter or mixed change may not be undone from the toast (§2.6.4). */
  private undoOffered = true;

  // ── The words ───────────────────────────────────────────────────────────

  /**
   * The language the catalogue has loaded, once it has: every word below
   * is built with `translate(…, lang)`, so no lookup inside a `computed`
   * starts a load.
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  protected readonly lang = computed(() => this.loadedLang() ?? 'bg');

  private readonly translate: Signal<Translate | null> = computed(() => {
    const lang = this.loadedLang();
    if (lang === null) return null;
    return (key, params) => this.transloco.translate(key, params, lang);
  });

  /** «дни» · «седмици» — the fields' units alone (V3-3). */
  protected readonly units: Signal<RhythmRuleUnits | null> = computed(() => {
    const translate = this.translate();
    return translate === null ? null : rhythmRuleUnits(translate, this.lang());
  });

  /** What every worded piece reads; `null` until the catalogue and the rule's words are there. */
  protected readonly context: Signal<AdminRhythmContext | null> = computed(
    () => {
      const translate = this.translate();
      const rule = this.store.rule();
      if (translate === null || rule === null) return null;
      return {
        translate,
        lang: this.lang(),
        today: this.store.days().today,
        rule,
      };
    },
  );

  // ── The page's state ────────────────────────────────────────────────────

  /** `loading` · `ready` · `failed`: what the page draws. */
  protected readonly state = computed(() => {
    const schedule = this.store.schedule();
    return schedule.status === 'ready' && this.context() !== null
      ? 'ready'
      : schedule.status === 'failed'
        ? 'failed'
        : 'loading';
  });

  /** The rule as the form holds it (`@let draft = current()` in the template). */
  protected readonly current = this.store.draft;
  private readonly draft = this.store.draft;

  /** The interval as the ruler holds it, in weeks. */
  protected readonly weeks = computed(() => {
    const draft = this.draft();
    return weeksOf(
      draft.streakInterval === StreakInterval.Fixed
        ? draft.intervalDays
        : draft.intervalFallbackDays,
    );
  });

  /** «6 седмици» — the interval ruler's readout and its value text. */
  protected readonly weeksText = computed(
    () => this.context()?.rule.weeks(this.weeks()) ?? '',
  );

  /** «7 дни» — the grace ruler's readout. */
  protected readonly graceText = computed(
    () => this.context()?.rule.days(this.draft().graceDays) ?? '',
  );

  protected readonly graceMax = computed(
    () => this.store.bounds().graceDays.max,
  );
  protected readonly graceMarks = computed(() => graceMarks(this.graceMax()));
  protected readonly weekMarks = weekMarks();
  protected readonly toleranceMarks = toleranceMarks();

  /** The personal interval, when the draft holds one. */
  protected readonly personal = computed(() => {
    const draft = this.draft();
    return draft.streakInterval === StreakInterval.Personal ? draft : null;
  });

  protected readonly toleranceText = computed(() => {
    const context = this.context();
    const personal = this.personal();
    return context === null || personal === null
      ? ''
      : toleranceReadout(context, personal.intervalTolerancePct);
  });

  protected readonly toleranceExample = computed(() => {
    const context = this.context();
    const personal = this.personal();
    return context === null || personal === null
      ? ''
      : toleranceExample(context, personal);
  });

  /** P2's menu, and what its trigger reads. */
  protected readonly qualifierOptions = computed(() =>
    this.withContext((context) => qualifierOptions(context), []),
  );
  /** P2's menu id for what the draft counts: every visit, or a list. */
  protected readonly qualifierChoice = computed(() =>
    this.draft().streakQualifier === StreakQualifier.AnyVisit
      ? 'anyVisit'
      : 'services',
  );
  protected readonly qualifierLabel = computed(
    () =>
      this.qualifierOptions().find(
        (option) => option.id === this.qualifierChoice(),
      )?.label ?? '',
  );
  /** «3 услуги» — the services row's value. */
  protected readonly servicesValue = computed(() => {
    const draft = this.draft();
    const count =
      draft.streakQualifier === StreakQualifier.Services
        ? draft.qualifierServiceIds.length
        : draft.streakQualifier === StreakQualifier.Categories
          ? draft.qualifierCategoryIds.length
          : 0;
    return this.withContext((context) => servicesCount(context, count), '');
  });

  protected readonly intervalOptions = computed(() =>
    this.withContext((context) => intervalOptions(context), []),
  );
  /** P5's menu id for the draft's interval. */
  protected readonly intervalChoice = computed(() =>
    this.draft().streakInterval === StreakInterval.Personal
      ? 'personal'
      : 'fixed',
  );
  protected readonly intervalLabel = computed(
    () =>
      this.intervalOptions().find(
        (option) => option.id === this.intervalChoice(),
      )?.label ?? '',
  );

  protected readonly riskLeadOptions = computed(() =>
    this.withContext((context) => riskLeadOptions(context), []),
  );
  protected readonly riskLeadLabel = computed(
    () => this.context()?.rule.days(this.draft().riskLeadDays) ?? '',
  );

  /** The three value rows of «Още правила». */
  protected readonly protectionsValue = computed(() =>
    this.withContext((context) => protectionsRow(context, this.draft()), ''),
  );
  protected readonly excusesValue = computed(() =>
    this.withContext((context) => excusesRow(context, this.draft()), ''),
  );
  protected readonly afterMissValue = computed(() =>
    this.withContext((context) => afterMissRow(context, this.draft()), ''),
  );

  /** «гратис 7 дни · защити до 2 в запас · извинения 3 от 4» — the rule card's digest; `null` while the rule is off. */
  protected readonly digest = computed(() =>
    this.withContext((context) => ruleDigest(context, this.draft()), null),
  );

  /** P13: the three days and the trigger's reading. */
  protected readonly effectiveOptions = computed(() =>
    this.withContext((context) => effectiveOptions(context), []),
  );
  protected readonly effective = computed(() =>
    this.withContext(
      (context) =>
        effectiveReading(
          context,
          this.store.effectiveFrom(),
          this.store.days(),
        ),
      { choice: 'tomorrow' as const, label: '' },
    ),
  );

  /** The rule card's capsule: «В сила от 1.09», or «От 1.10» while a version waits. */
  protected readonly capsule = computed(() => {
    const context = this.context();
    if (context === null || !this.store.published()) return null;
    const upcoming = this.store.upcoming();
    if (upcoming !== null) {
      return inForceCapsule(context, upcoming.effectiveFromLocalDate, true);
    }
    const inForce = this.store.inForce();
    return inForce === null
      ? null
      : inForceCapsule(context, inForce.effectiveFromLocalDate, false);
  });

  /** «От 1.10: на всеки 5 седмици» — the waiting version's second sentence. */
  protected readonly upcomingLine = computed(() => {
    const context = this.context();
    const upcoming = this.store.upcoming();
    const words = this.store.upcomingRule();
    if (context === null || upcoming === null || words === null) return null;
    return upcomingLine(context, upcoming.effectiveFromLocalDate, words.short);
  });

  /** The sample run under the draft, as the track draws it; `null` under a rule that is off. */
  protected readonly sample = computed(() => {
    const context = this.context();
    const state = this.store.sample();
    if (context === null || state === null) return null;
    return {
      count: state.current,
      periods: samplePeriods(context, state),
      label: sampleLabel(context, state),
      unit: sampleUnit(context),
    };
  });

  /** «Какво ще се промени», worded; `null` while there is nothing to preview. */
  protected readonly preview = computed((): AdminRhythmPreviewWords | null => {
    const context = this.context();
    const preview = this.store.preview();
    if (context === null || preview === null || preview.status !== 'ready') {
      return null;
    }
    return previewWords(
      context,
      preview.data,
      this.store.previewCapped(),
      RHYTHM_PREVIEW_CAP,
    );
  });

  /** «История», newest first. */
  protected readonly history = computed(
    (): readonly AdminRhythmHistoryRow[] => {
      const context = this.context();
      const versions = this.store.versions();
      if (context === null || versions.status !== 'ready') return [];
      return [...versions.data]
        .sort((a, b) => b.version - a.version)
        .map((version) => historyRow(context, version));
    },
  );

  /** What a refused «Запази», or the rule moving under the draft, says. */
  protected readonly refusalNotice = computed(() => {
    const context = this.context();
    const refusal = this.store.refusal();
    if (context === null || refusal === null) return null;
    return this.wordRefusal(context, refusal);
  });

  /** Offline: the dock is absent and this says why. */
  protected readonly offlineNotice = computed(() => {
    const translate = this.translate();
    return translate === null || this.store.online()
      ? null
      : translate('admin.rhythm.offline');
  });

  // ── The catalogue (the services sheet, the rule's named services) ───────

  /**
   * The catalogue's services under their categories (`rhythmServiceGroupsOf`
   * over the two live streams); `null` until both have answered, when
   * either fails, or with no catalogue bound.
   */
  protected readonly serviceGroups: Signal<
    readonly RhythmServiceGroup[] | null
  > = toSignal(
    this.catalog === null
      ? of(null)
      : combineLatest([
          this.catalog.observeCategories(),
          this.catalog.observeServices(null),
        ]).pipe(
          map(([categories, services]) =>
            categories.ok && services.ok
              ? rhythmServiceGroupsOf(categories.value, services.value)
              : null,
          ),
        ),
    { initialValue: null },
  );

  // ── The alert ───────────────────────────────────────────────────────────

  protected readonly confirmTitle = computed(() => {
    const translate = this.translate();
    const confirm = this.confirm();
    if (translate === null || confirm === null) return '';
    return translate(`admin.rhythm.confirm.${confirm}`);
  });

  protected readonly confirmMessage = computed(() => {
    const translate = this.translate();
    const confirm = this.confirm();
    if (translate === null || confirm === null) return null;
    switch (confirm) {
      case 'switchOff':
        return translate('admin.rhythm.confirm.switchOffMessage');
      case 'switchOn':
        return this.store.rule()?.sentence ?? null;
      case 'stricter': {
        const preview = this.preview();
        return preview !== null && preview.kind === 'estimate'
          ? `${preview.clients} · ${preview.summary}`
          : null;
      }
      case 'discard':
        return null;
    }
  });

  /** The alert's answers: the destructive one, and the safe one last, bold, what Escape means. */
  protected readonly confirmActions = computed<readonly UiAlertAction[]>(() => {
    const translate = this.translate();
    const confirm = this.confirm();
    if (translate === null || confirm === null) return [];
    const keep: UiAlertAction = {
      id: 'keep',
      label: translate('admin.rhythm.confirm.discardKeep'),
      role: 'cancel',
      preferred: confirm === 'discard',
      testId: 'admin-rhythm-confirm-keep',
    };
    if (confirm === 'discard') {
      return [
        {
          id: 'discard',
          label: translate('admin.rhythm.confirm.discardYes'),
          role: 'destructive',
          testId: 'admin-rhythm-confirm-discard',
        },
        keep,
      ];
    }
    return [
      {
        id: 'save',
        label: translate('admin.rhythm.save'),
        role: 'default',
        testId: 'admin-rhythm-confirm-save',
      },
      keep,
    ];
  });

  constructor() {
    this.store.load();
    // The rule's sentence names the counted services once the catalogue
    // has answered: the store is told the names, untracked, as the
    // effects rule asks.
    effect(() => {
      const groups = this.serviceGroups();
      const lang = this.lang();
      if (groups === null) return;
      const names = new Map<string, string>();
      for (const group of groups) {
        for (const service of group.services) {
          names.set(
            service.id,
            LocalizedText.pick(service.name, lang === 'en' ? 'en' : 'bg'),
          );
        }
      }
      untracked(() => this.store.nameServices(names));
    });
  }

  // ── The guard ───────────────────────────────────────────────────────────

  /**
   * May the admin leave? With a draft the page asks first («Отхвърли
   * промените?») and answers what the admin chose; without one it
   * answers `true` at once.
   */
  confirmLeave(): Promise<boolean> {
    if (!this.store.dirty()) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.leaving?.(false);
      this.leaving = resolve;
      this.confirm.set('discard');
    });
  }

  // ── What the controls do ────────────────────────────────────────────────

  protected id(name: string): string {
    return `admin-rhythm-${this.seq}-${name}`;
  }

  protected patch(partial: AdminRhythmPatch): void {
    this.withdrawArmed.set(false);
    this.store.patch(partial);
  }

  /** A unit field's figure, typed: a number is clamped by the store; anything else leaves the field as it was. */
  protected typed(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  protected pickQualifier(id: string): void {
    if (id === 'services') {
      const draft = this.draft();
      this.patch({
        qualifier:
          draft.streakQualifier === StreakQualifier.Services
            ? StreakQualifierRule.of(draft)
            : StreakQualifierRule.services([]),
      });
      // A list with nothing chosen is no rule: the sheet opens on the choice.
      this.openSheet('services');
      return;
    }
    this.patch({ qualifier: StreakQualifierRule.anyVisit() });
  }

  protected pickInterval(id: string): void {
    this.patch({
      interval: id === 'personal' ? personalInterval() : fixedInterval(),
    });
  }

  protected setWeeks(weeks: number): void {
    this.patch({ interval: fixedInterval(daysOf(weeks)) });
  }

  protected setTolerance(percent: number): void {
    this.patch({
      interval: personalInterval({ intervalTolerancePct: percent }),
    });
  }

  protected setClamp(
    part: 'intervalMinDays' | 'intervalMaxDays' | 'intervalFallbackDays',
    value: string,
  ): void {
    const weeks = this.typed(value);
    if (weeks === undefined) return;
    this.patch({ interval: personalInterval({ [part]: daysOf(weeks) }) });
  }

  protected setHoldDays(value: string): void {
    const days = this.typed(value);
    if (days !== undefined) this.patch({ bookingHoldMaxDaysPastDue: days });
  }

  protected setMinGap(value: string): void {
    const days = this.typed(value);
    if (days !== undefined) this.patch({ minGapDays: days });
  }

  protected pickRiskLead(id: string): void {
    this.patch({ riskLeadDays: Number(id) });
  }

  protected pickEffective(id: string): void {
    const days = this.store.days();
    if (id === 'pick') {
      this.openSheet('day');
      return;
    }
    this.store.setEffectiveFrom(
      id === 'firstOfMonth' ? days.firstOfMonth : days.tomorrow,
    );
  }

  protected openSheet(kind: AdminRhythmSheetKind): void {
    this.withdrawArmed.set(false);
    this.sheetKind.set(kind);
  }

  protected closeSheet(): void {
    this.sheetKind.set(null);
  }

  /** The value a unit field shows: the draft's figure, as text. */
  protected text(value: number): string {
    return String(value);
  }

  /** A clamp's figure in weeks, as the field edits it. */
  protected weeksOf(days: number): number {
    return weeksOf(days);
  }

  // ── «Запази», the receipt, «Отмени» ─────────────────────────────────────

  /**
   * «Запази» classifies the change (§2.6.4): a looser or neutral one is
   * saved at once; a stricter or mixed one, or a flip of the switch, asks
   * first.
   */
  protected save(): void {
    const change = this.store.change();
    if (change === null || !this.store.canSave()) return;
    const direction = change.direction;
    if (direction === StreakRuleDirection.Switch) {
      this.confirm.set(this.draft().enabled ? 'switchOn' : 'switchOff');
      return;
    }
    if (
      direction === StreakRuleDirection.Stricter ||
      direction === StreakRuleDirection.Mixed
    ) {
      this.confirm.set('stricter');
      return;
    }
    void this.publish(direction);
  }

  private async publish(direction: StreakRuleDirection): Promise<void> {
    this.undoOffered =
      direction === StreakRuleDirection.Looser ||
      direction === StreakRuleDirection.Neutral;
    const outcome = await this.store.save();
    this.told(outcome);
  }

  /** The receipt («Правилото е запазено · от 30.09»), or a refusal said in passing — by its `errorCode`. */
  private told(outcome: AdminRhythmSaveOutcome): void {
    const context = this.context();
    if (context === null) return;
    const t = context.translate;
    if (outcome.ok) {
      // `null`: nothing to publish, said by nothing.
      if (outcome.value === null) return;
      this.toast.set({
        label: t('admin.rhythm.receipt', {
          date: shortDay(
            outcome.value.effectiveFromLocalDate,
            context.today,
            context.lang,
          ),
        }),
        undo: outcome.value.waits && this.undoOffered,
      });
      return;
    }
    const refusal = outcome.error;
    if (!isPublishRefusal(refusal)) {
      this.toast.set({
        label: translateDomainError(this.transloco, {
          code: 'repository_failure',
        }),
        undo: false,
      });
      return;
    }
    switch (refusal.errorCode) {
      case StreakPublishErrorCode.CallerNotAdmin:
      case StreakPublishErrorCode.CallerUnauthenticated:
        this.toast.set({
          label: translateDomainError(this.transloco, {
            code: 'booking.staffEdit.forbidden',
          }),
          undo: false,
        });
        return;
      default:
        // Said by the notice under the head (`refusalNotice`).
        return;
    }
  }

  /** The toast's «Отмени», and the history's armed row: the waiting version is called off. */
  protected undo(): void {
    this.toast.set(null);
    void this.withdraw();
  }

  protected tapWithdraw(): void {
    if (!this.withdrawArmed()) {
      this.withdrawArmed.set(true);
      return;
    }
    this.withdrawArmed.set(false);
    void this.withdraw();
  }

  private async withdraw(): Promise<void> {
    const outcome = await this.store.undo();
    if (!outcome.ok && !isPublishRefusal(outcome.error)) {
      this.toast.set({
        label: translateDomainError(this.transloco, {
          code: 'repository_failure',
        }),
        undo: false,
      });
    }
  }

  protected retry(): void {
    this.store.retry();
  }

  // ── The alert's answers ─────────────────────────────────────────────────

  protected onConfirmPick(id: string): void {
    const confirm = this.confirm();
    this.confirm.set(null);
    if (confirm === 'discard') {
      const answer = id === 'discard';
      if (answer) this.store.discard();
      this.leaving?.(answer);
      this.leaving = null;
      return;
    }
    if (confirm === null || id !== 'save') return;
    void this.publish(
      confirm === 'stricter'
        ? StreakRuleDirection.Stricter
        : StreakRuleDirection.Switch,
    );
  }

  protected onConfirmDismiss(): void {
    const confirm = this.confirm();
    this.confirm.set(null);
    if (confirm === 'discard') {
      this.leaving?.(false);
      this.leaving = null;
    }
  }

  // ── Support ─────────────────────────────────────────────────────────────

  private withContext<T>(
    read: (context: AdminRhythmContext) => T,
    fallback: T,
  ): T {
    const context = this.context();
    return context === null ? fallback : read(context);
  }

  /** A refusal, worded by its `errorCode`; the ones said in passing (the toast) or by nothing are `null` here. */
  private wordRefusal(
    context: AdminRhythmContext,
    refusal: AdminRhythmRefusal,
  ): string | null {
    const t = context.translate;
    if (!isPublishRefusal(refusal)) {
      return translateDomainError(this.transloco, {
        code: 'repository_failure',
      });
    }
    switch (refusal.errorCode) {
      case StreakPublishErrorCode.Stale:
        return t('admin.rhythm.refused.stale');
      case StreakPublishErrorCode.Invalid:
        return invalidNotice(context, refusal.fields);
      case StreakPublishErrorCode.TooEarly:
        return t('admin.rhythm.refused.tooEarly', {
          date: shortDay(refusal.earliest, context.today, context.lang),
        });
      default:
        return null;
    }
  }
}
