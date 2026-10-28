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
import { map } from 'rxjs/operators';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  LocalizedText,
  RhythmEffectiveChoice,
  StreakInterval,
  StreakIntervalRule,
  StreakPublishConsent,
  StreakQualifier,
  StreakQualifierRule,
  StreakRuleDirection,
} from '@core/components';
import {
  EngagementErrorCode,
  type RhythmPublishRefusal,
  StreakPublishError,
  StreakPublishErrorCode,
} from '@core/errors';
import { Locale, type ServiceId, Tag } from '@core/primitives';
import {
  CatalogSystem,
  RhythmDraftSystem,
  StreakPublishSystem,
  StreakRuleSystem,
} from '@core/systems';
import {
  translateCodedError,
  loadedLanguage,
} from '@creativo/infrastructure/i18n';
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
import { LoadState, loadStateWords } from '@creativo/shared/view-state';
import type { AdminRhythmLeaving } from '../admin-rhythm.guard';
import { RHYTHM_PREVIEW_CAP } from '../admin-rhythm.preview';
import {
  type AdminRhythmPatch,
  type AdminRhythmSaveOutcome,
  AdminRhythmStore,
  fixedInterval,
  personalInterval,
} from '../admin-rhythm.store';
import {
  AdminRhythmSheet,
  RhythmSheet,
  type RhythmServiceGroup,
} from '../admin-rhythm-sheet/admin-rhythm-sheet';
import {
  type AdminRhythmContext,
  type AdminRhythmHistoryRow,
  RhythmEstimate,
  type RhythmEstimateLine,
  afterMissRow,
  effectiveOptions,
  effectiveReading,
  excusesRow,
  graceMarks,
  historyRow,
  inForceCapsule,
  intervalOptions,
  previewWords,
  protectionsRow,
  qualifierOptions,
  refusedFields,
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
} from './admin-rhythm.words';

/** A word the page prints that is not a bare key: built once the catalogue has loaded. */
type Translate = AdminRhythmContext['translate'];

/**
 * What «Запази» or a leave asks first, as `ui-alert` — the field `confirm`,
 * the ONLY source of these strings (Law 1). Values: external contract —
 * each is the i18n key segment of the alert's title
 * (`admin.rhythm.confirm.<value>`), so the spelling stays.
 */
const RhythmConfirmation = {
  /** A stricter or mixed change: «Запази» asks first. */
  Stricter: 'stricter',
  /** The rhythm switched off. */
  SwitchOff: 'switchOff',
  /** The rhythm switched on. */
  SwitchOn: 'switchOn',
  /** A leave with a draft: «Отхвърли промените?». */
  Discard: 'discard',
} as const;
type RhythmConfirmation =
  (typeof RhythmConfirmation)[keyof typeof RhythmConfirmation];

/**
 * The alert's answers — the id of each `UiAlertAction`, handed back by
 * `ui-alert` (`uiPicked`). Internal: the buttons are found by their test
 * ids (`admin-rhythm-confirm-<answer>`), never by the id.
 */
const RhythmAlertAnswer = {
  /** The safe answer: the draft stays. */
  Keep: 'KEEP',
  /** The draft goes, and the page lets go. */
  Discard: 'DISCARD',
  /** «Запази» after all. */
  Save: 'SAVE',
} as const;

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
    '[attr.data-state]': 'stateWord()',
  },
})
export class AdminRhythm implements AdminRhythmLeaving {
  protected readonly store = inject(AdminRhythmStore);
  /** Where each read stands, for the template's switches. */
  protected readonly LoadState = LoadState;
  /** What the preview can say, for the template. */
  protected readonly RhythmEstimate = RhythmEstimate;
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CATALOG_PORTS, { optional: true });

  private readonly seq = ++sequence;

  // ── The sheets, the alert, the toast ────────────────────────────────────

  /** The sheets, for the template's rows (never bare literals). */
  protected readonly RhythmSheet = RhythmSheet;
  /** The qualifier's menu ids, for the template. */
  protected readonly StreakQualifier = StreakQualifier;
  /** The sheet that is open; `null` for none. */
  protected readonly sheet = signal<RhythmSheet | null>(null);
  /** The question on screen; `null` for none. */
  protected readonly confirm = signal<RhythmConfirmation | null>(null);
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
  /**
   * The direction of the change «Запази» sent last: whether its receipt
   * offers «Отмени» is `StreakPublishSystem.undoOffered`'s answer — a
   * stricter or mixed change may not be undone from the toast (§2.6.4).
   */
  private sentDirection: StreakRuleDirection = StreakRuleDirection.Neutral;

  // ── The words ───────────────────────────────────────────────────────────

  /**
   * The language the catalogue has loaded, once it has: every word below
   * is built with `translate(…, lang)`, so no lookup inside a `computed`
   * starts a load.
   */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  protected readonly lang = computed(() => this.loadedLang() ?? Locale.Bg);

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
      const days = this.store.days();
      const zone = this.store.zone();
      // Until the shop's days are known the page is its skeleton.
      if (
        translate === null ||
        rule === null ||
        days === null ||
        zone === null
      ) {
        return null;
      }
      return {
        translate,
        lang: this.lang(),
        today: days.today,
        zone,
        rule,
      };
    },
  );

  // ── The page's state ────────────────────────────────────────────────────

  /** `READY` · `FAILED` · `LOADING`: what the page draws. */
  protected readonly state = computed((): LoadState => {
    const schedule = this.store.schedule();
    return schedule.loadState === LoadState.Ready && this.context() !== null
      ? LoadState.Ready
      : schedule.loadState === LoadState.Failed
        ? LoadState.Failed
        : LoadState.Loading;
  });

  /** The page's `data-state` — `loading` · `ready` · `failed`. */
  protected readonly stateWord = computed(() => loadStateWords[this.state()]);

  /** The rule as the form holds it (`@let draft = current()` in the template). */
  protected readonly current = this.store.draft;
  private readonly draft = this.store.draft;

  /** The interval as the ruler holds it, in weeks: the newcomer's period (`StreakIntervalRule.daysFor`, no habit yet). */
  protected readonly weeks = computed(() =>
    RhythmDraftSystem.weeksOf(
      StreakIntervalRule.daysFor(this.draft(), null).days,
    ),
  );

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
  /** P2's menu id for what the draft counts: every visit, or a list (services or categories alike). */
  protected readonly qualifierChoice = computed(() =>
    this.draft().streakQualifier === StreakQualifier.AnyVisit
      ? StreakQualifier.AnyVisit
      : StreakQualifier.Services,
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
  protected readonly intervalChoice = computed(
    () => this.draft().streakInterval,
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
  protected readonly effective = computed(() => {
    const blank = { choice: RhythmEffectiveChoice.Tomorrow, label: '' };
    const day = this.store.effectiveFrom();
    const days = this.store.days();
    return day === null || days === null
      ? blank
      : this.withContext(
          (context) => effectiveReading(context, day, days),
          blank,
        );
  });

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
  protected readonly preview = computed((): RhythmEstimateLine | null => {
    const context = this.context();
    const preview = this.store.preview();
    if (
      context === null ||
      preview === null ||
      preview.loadState !== LoadState.Ready
    ) {
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
      if (context === null || versions.loadState !== LoadState.Ready) {
        return [];
      }
      return StreakPublishSystem.historyNewestFirst(versions.data).map(
        (version) => historyRow(context, version),
      );
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
   * The catalogue's services under their categories (`CatalogSystem.byCategory`
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
          this.catalog.observeServices(),
        ]).pipe(
          map(([categories, services]) =>
            categories.ok && services.ok
              ? CatalogSystem.byCategory(categories.value, services.value)
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
      case RhythmConfirmation.SwitchOff:
        return translate('admin.rhythm.confirm.switchOffMessage');
      case RhythmConfirmation.SwitchOn:
        return this.store.rule()?.sentence ?? null;
      case RhythmConfirmation.Stricter: {
        const preview = this.preview();
        return preview !== null &&
          preview.rhythmEstimate === RhythmEstimate.Estimate
          ? `${preview.clients} · ${preview.summary}`
          : null;
      }
      case RhythmConfirmation.Discard:
        return null;
    }
  });

  /** The alert's answers: the destructive one, and the safe one last, bold, what Escape means. */
  protected readonly confirmActions = computed<readonly UiAlertAction[]>(() => {
    const translate = this.translate();
    const confirm = this.confirm();
    if (translate === null || confirm === null) return [];
    const keep: UiAlertAction = {
      id: RhythmAlertAnswer.Keep,
      label: translate('admin.rhythm.confirm.discardKeep'),
      role: 'cancel',
      preferred: confirm === RhythmConfirmation.Discard,
      testId: 'admin-rhythm-confirm-keep',
    };
    if (confirm === RhythmConfirmation.Discard) {
      return [
        {
          id: RhythmAlertAnswer.Discard,
          label: translate('admin.rhythm.confirm.discardYes'),
          role: 'destructive',
          testId: 'admin-rhythm-confirm-discard',
        },
        keep,
      ];
    }
    return [
      {
        id: RhythmAlertAnswer.Save,
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
      const names = new Map<ServiceId, string>();
      for (const group of groups) {
        for (const service of group.services) {
          names.set(
            service.id,
            LocalizedText.pick(service.name, Tag.or(Locale, lang, Locale.Bg)),
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
      this.confirm.set(RhythmConfirmation.Discard);
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

  /** P2's answer — `ui-choice-menu`'s untyped id, a `StreakQualifier` member: the list, or every visit. */
  protected pickQualifier(id: string): void {
    if (id === StreakQualifier.Services) {
      const draft = this.draft();
      this.patch({
        qualifier:
          draft.streakQualifier === StreakQualifier.Services
            ? StreakQualifierRule.of(draft)
            : StreakQualifierRule.services([]),
      });
      // A list with nothing chosen is no rule: the sheet opens on the choice.
      this.openSheet(RhythmSheet.Services);
      return;
    }
    this.patch({ qualifier: StreakQualifierRule.anyVisit() });
  }

  /** P5's answer — a `StreakInterval` member: by the client's habit, else the same for everyone. */
  protected pickInterval(id: string): void {
    this.patch({
      interval:
        id === StreakInterval.Personal ? personalInterval() : fixedInterval(),
    });
  }

  protected setWeeks(weeks: number): void {
    this.patch({ interval: fixedInterval(RhythmDraftSystem.daysOf(weeks)) });
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
    this.patch({
      interval: personalInterval({ [part]: RhythmDraftSystem.daysOf(weeks) }),
    });
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

  /** P13's answer — a `RhythmEffectiveChoice` member: a day of the admin's own opens the picker. */
  protected pickEffective(id: string): void {
    const days = this.store.days();
    if (id === RhythmEffectiveChoice.Picked) {
      this.openSheet(RhythmSheet.Day);
      return;
    }
    if (days === null) return;
    this.store.setEffectiveFrom(
      id === RhythmEffectiveChoice.FirstOfMonth
        ? days.firstOfMonth
        : days.tomorrow,
    );
  }

  protected openSheet(sheet: RhythmSheet): void {
    this.withdrawArmed.set(false);
    this.sheet.set(sheet);
  }

  protected closeSheet(): void {
    this.sheet.set(null);
  }

  /** The value a unit field shows: the draft's figure, as text. */
  protected text(value: number): string {
    return String(value);
  }

  /** A clamp's figure in weeks, as the field edits it. */
  protected weeksOf(days: number): number {
    return RhythmDraftSystem.weeksOf(days);
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
    switch (StreakRuleSystem.publishConsent(direction)) {
      case StreakPublishConsent.AskSwitch:
        this.confirm.set(
          this.draft().enabled
            ? RhythmConfirmation.SwitchOn
            : RhythmConfirmation.SwitchOff,
        );
        return;
      case StreakPublishConsent.Ask:
        this.confirm.set(RhythmConfirmation.Stricter);
        return;
      case StreakPublishConsent.AtOnce:
        void this.publish(direction);
        return;
    }
  }

  private async publish(direction: StreakRuleDirection): Promise<void> {
    this.sentDirection = direction;
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
        undo: StreakPublishSystem.undoOffered(
          this.sentDirection,
          outcome.value.waits,
        ),
      });
      return;
    }
    const refusal = outcome.error;
    if (!StreakPublishError.guard(refusal)) {
      this.toast.set({
        label: translateCodedError(this.transloco, {
          errorCode: EngagementErrorCode.RepositoryFailure,
        }),
        undo: false,
      });
      return;
    }
    switch (refusal.errorCode) {
      case StreakPublishErrorCode.CallerNotAdmin:
      case StreakPublishErrorCode.CallerUnauthenticated:
        // Each code's own line (`errors.LOYALTY_STREAK_PUBLISH_CALLER_*`,
        // OR-50/OR-52): the one not-allowed line, or «Влез отново, за да
        // продължиш.»
        this.toast.set({
          label: translateCodedError(this.transloco, refusal),
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
    if (!outcome.ok && !StreakPublishError.guard(outcome.error)) {
      this.toast.set({
        label: translateCodedError(this.transloco, {
          errorCode: EngagementErrorCode.RepositoryFailure,
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
    if (confirm === RhythmConfirmation.Discard) {
      const answer = id === RhythmAlertAnswer.Discard;
      if (answer) this.store.discard();
      this.leaving?.(answer);
      this.leaving = null;
      return;
    }
    if (confirm === null || id !== RhythmAlertAnswer.Save) return;
    void this.publish(
      confirm === RhythmConfirmation.Stricter
        ? StreakRuleDirection.Stricter
        : StreakRuleDirection.Switch,
    );
  }

  protected onConfirmDismiss(): void {
    const confirm = this.confirm();
    this.confirm.set(null);
    if (confirm === RhythmConfirmation.Discard) {
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

  /**
   * A refusal, worded by its `errorCode` (Law 7.5): `errors.<errorCode>`
   * with the struct as its params, the display params the page formats
   * (`{{date}}`, `{{field}}`) spread over it. A request that got no answer
   * keeps the shop's "our side" words; the ones said in passing (the toast)
   * are `null` here. No `default`: a new refusal in the union fails the
   * build until it is worded here (OR-52), never a silent save.
   */
  private wordRefusal(
    context: AdminRhythmContext,
    refusal: RhythmPublishRefusal,
  ): string | null {
    if (!StreakPublishError.guard(refusal)) {
      return translateCodedError(this.transloco, {
        errorCode: EngagementErrorCode.RepositoryFailure,
      });
    }
    switch (refusal.errorCode) {
      case StreakPublishErrorCode.Stale:
      case StreakPublishErrorCode.RecomputeNeedsEngine:
      case StreakPublishErrorCode.PreviewStale:
        return translateCodedError(this.transloco, refusal);
      case StreakPublishErrorCode.Invalid:
        return translateCodedError(this.transloco, {
          ...refusal,
          field: refusedFields(context, refusal.fields),
        });
      case StreakPublishErrorCode.TooEarly:
        return translateCodedError(this.transloco, {
          ...refusal,
          date: shortDay(refusal.earliest, context.today, context.lang),
        });
      case StreakPublishErrorCode.CallerNotAdmin:
      case StreakPublishErrorCode.CallerUnauthenticated:
        // Said in passing by the toast (`told`), not under the head: the
        // caller, not the rule, is what was refused.
        return null;
    }
  }
}
