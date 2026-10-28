import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  type Signal,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { loadedLanguage } from '@creativo/infrastructure/i18n';
import {
  CLIENT_STATS_READ_PORTS,
  CLOCK_PORTS,
  FLAGS_PORTS,
  ID_PORTS,
  STREAK_DEFINITION_PORTS,
  STREAK_PUBLISH_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import type { StreakDefinition, StreakDefinitionVersion } from '@core/entities';
import type { StreakDefinitionPorts } from '@core/ports';
import {
  type LocalDate,
  PublishRequestId,
  Result,
  type ServiceCategoryId,
  type ServiceId,
  type TimeZone,
  type UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  type EngagementError,
  RepositoryError,
  type RhythmPublishRefusal,
  StreakPublishError,
  StreakPublishErrorCode,
} from '@core/errors';
import {
  DraftAssessment,
  FlagName,
  HeadRole,
  StreakInterval,
  type StreakHeadRule,
  type StreakPreview,
  StreakRule,
  type StreakRuleInput,
  type StreakState,
  StreakTransition,
} from '@core/components';
import {
  type RememberedIntervals,
  RhythmDraftSystem,
  type RhythmEffectivePresets,
  type RhythmIntervalPatch,
  type RhythmPatch,
  type StreakDraftAssessment,
  type StreakEffectiveDay,
  type StreakNoticePolicy,
  StreakPreviewSystem,
  type StreakPublishFloor,
  StreakPublishSystem,
  type StreakRuleChange,
  StreakRuleSystem,
  type StreakSchedule,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type RhythmDraftReceipt,
  type RhythmPublishOutcome,
  type RhythmWithdrawOutcome,
  publishRhythmDraft,
  rhythmPreviewSource,
  withdrawRhythm,
} from '@core/pipelines';
import {
  type RhythmRuleWords,
  rhythmRuleWords,
} from '@creativo/features/shared/visits';
import { LoadSlice, LoadState, timedRead } from '@creativo/shared/view-state';
import {
  RHYTHM_PREVIEW_DELAY_MS,
  rhythmPreviewOf,
} from './admin-rhythm.preview';

// ── What the page reads ────────────────────────────────────────────────────

/*
 * Where one read stands — a skeleton, the content, or «Опитай пак» — is the
 * shared `LoadState` on a `LoadSlice` (`@creativo/shared/view-state`, UI
 * residue cleanup UR-2): this page reads the ONE vocabulary every screen
 * reads, never a local copy of it.
 */

/** A read that has not answered by then counts as failed. */
export const ADMIN_RHYTHM_READ_TIMEOUT_MS = 10_000;

/**
 * A read that did not answer within `ADMIN_RHYTHM_READ_TIMEOUT_MS`, and one
 * that threw instead of answering — `timedRead`'s two failure answers (the
 * client card's, word for word).
 */
const READ_FAILURES = {
  timedOut: Result.err(RepositoryError.readFailed(null, 'timeout')),
  threw: Result.err(RepositoryError.readFailed(null, 'threw')),
} as const;

/** How much of the history «История» lists. */
export const ADMIN_RHYTHM_HISTORY_LIMIT = 20;

/** What the new rule does to the runs that exist. «Преизчисляват се» needs the engine and is not offered. */
export const ADMIN_RHYTHM_TRANSITION: StreakTransition =
  StreakTransition.Grandfather;

/**
 * What the page's menus offer (§2.6.2 P7, P8b, P10, P11). The rule allows
 * every whole number of a range; a menu shows a few of them, and the
 * store snaps to one of THESE where a figure it did not ask for has to
 * move (the cue, when the interval shrinks under it).
 */
export const ADMIN_RHYTHM_CHOICES = {
  riskLeadDays: [0, 3, 7, 14],
  earnEvery: [3, 4, 5, 6, 8, 10],
  pauseDaysPerYear: [30, 60, 90],
  repairWindowDays: [7, 14, 21, 30],
  repairPerYear: [1, 2, 3],
} as const;

/**
 * A change to the draft: any parameter of the rule, any figure of a part,
 * FLAT — the system's `RhythmPatch` with only what moves named. A
 * version's identity (`version`, `effectiveFromLocalDate`) is not the
 * form's to say and is not here. The interval and the qualifier are named
 * whole, as the slices they are (`fixedInterval`, `personalInterval`).
 */
export type AdminRhythmPatch = Partial<RhythmPatch>;

/** The figures of a personal interval a change may name; the rest stay as held. */
export type PersonalIntervalFigures = {
  readonly intervalTolerancePct?: number;
  readonly intervalMinDays?: number;
  readonly intervalMaxDays?: number;
  readonly intervalFallbackDays?: number;
};

/** A fixed interval as a change names it: the days, or as held (`null`). Naming it SWITCHES to it. */
export function fixedInterval(
  intervalDays: number | null = null,
): RhythmIntervalPatch {
  return { streakInterval: StreakInterval.Fixed, intervalDays };
}

/** A personal interval as a change names it: the figures given, the rest as held. Naming it SWITCHES to it. */
export function personalInterval(
  figures: PersonalIntervalFigures = {},
): RhythmIntervalPatch {
  return {
    streakInterval: StreakInterval.Personal,
    intervalTolerancePct: figures.intervalTolerancePct ?? null,
    intervalMinDays: figures.intervalMinDays ?? null,
    intervalMaxDays: figures.intervalMaxDays ?? null,
    intervalFallbackDays: figures.intervalFallbackDays ?? null,
  };
}

/**
 * The rule as the page opens it: the head (the rule in force and the one
 * that waits) and whether the shop has published it. `published: false`:
 * nothing is published yet and the head is the RECOMMENDED rule
 * (`StreakRule.DEFAULT`), with nothing waiting; the first «Запази» then has
 * nothing to be stale against (`baseVersion` 0) and is numbered 1.
 */
export type AdminRhythmHead = {
  readonly schedule: StreakSchedule;
  readonly published: boolean;
};

/**
 * A «Запази» that landed: the server's receipt, and whether its day is
 * still to come (it can then be called off) — `publishRhythmDraft`'s
 * answer (`@core/pipelines`).
 */
export type AdminRhythmReceipt = RhythmDraftReceipt;

/**
 * What became of a «Запази»: the receipt; `null` when there was nothing to
 * publish (the draft IS the rule in force, figure for figure); or the
 * refusal. Every answer is one the page words; none is thrown.
 */
export type AdminRhythmSaveOutcome = RhythmPublishOutcome;

/** What became of an «Отмени»: the version called off; `null` when nothing waits; or the refusal. */
export type AdminRhythmUndoOutcome = RhythmWithdrawOutcome;

/** The three days «Влизане в сила» names (`RhythmDraftSystem.effectivePresets`). */
export type AdminRhythmDays = RhythmEffectivePresets;

// ── The draft, clamped ─────────────────────────────────────────────────────

/** A change that names only what moves, as the system reads it: every other figure `null`. */
function rhythmPatchOf(patch: AdminRhythmPatch): RhythmPatch {
  return {
    ...RhythmDraftSystem.NO_CHANGE,
    ...patch,
    interval: patch.interval ?? null,
  };
}

/**
 * The draft with a change over it, CLAMPED (`RhythmDraftSystem.clamp`):
 * every figure whole and inside the rule's range (`StreakRule.LIMITS`, the
 * table `StreakRule.parse` refuses by), and what depends on another figure
 * held to it, so no combination the controls can reach is one the rule
 * refuses (§2.6.4). The figure in hand wins; what depends on it follows.
 *
 * What it cannot mend is a LIST: «Посещение с избрани услуги» with no
 * service chosen yet is no rule, and the store says so (`validation`)
 * until one is. Every draft the store holds comes out of here, so two
 * drafts are told apart by their JSON.
 */
export function patchedRhythmDraft(
  draft: StreakRuleInput,
  patch: AdminRhythmPatch,
  remembered: RememberedIntervals = RhythmDraftSystem.NOTHING_REMEMBERED,
): StreakRuleInput {
  return RhythmDraftSystem.clamp(
    draft,
    rhythmPatchOf(patch),
    remembered,
    ADMIN_RHYTHM_CHOICES.riskLeadDays,
  );
}

/** A rule as the form holds it: the rule alone (no head role), through the same clamp every change takes. */
const draftOf = (rule: StreakRuleInput): StreakRuleInput =>
  patchedRhythmDraft(rule, {});

// ── The head, told apart ───────────────────────────────────────────────────

/** The recommended rule, as a head with nothing waiting. */
const RECOMMENDED_SCHEDULE: StreakSchedule = {
  rules: [
    {
      ...StreakRule.DEFAULT,
      headRole: HeadRole.Current,
      streakTransition: null,
    },
  ],
};

/** The head the port answered, as the page opens it: the recommended rule where none is published. */
const headOf = (head: StreakDefinition | null): AdminRhythmHead =>
  head === null
    ? { schedule: RECOMMENDED_SCHEDULE, published: false }
    : { schedule: head, published: true };

/** Which versions a head holds: two heads that answer the same hold the same rule. */
const versionsOf = (head: AdminRhythmHead): string =>
  [
    head.published ? 'published' : 'recommended',
    StreakRuleSystem.current(head.schedule).version,
    StreakRuleSystem.scheduled(head.schedule)?.version ?? 0,
  ].join(':');

/**
 * The head a publish leaves behind, worked out from its answer: what the
 * page stands on until the stream says the same — the receipt's version
 * and day on the assessed rule, placed by `StreakPublishSystem.headAfter`
 * (the server's own `decide` places it the same way): in force at once
 * when its day has come (and always for a shop's first rule — an
 * unpublished shop has no head yet), else waiting beside the rule in force.
 */
function headAfterPublish(
  base: AdminRhythmHead,
  assessed: StreakRule,
  receipt: AdminRhythmReceipt,
  today: LocalDate,
): AdminRhythmHead | null {
  const numbered: StreakRule = {
    ...StreakRule.of(assessed),
    version: receipt.version,
    effectiveFromLocalDate: receipt.effectiveFromLocalDate,
  };
  const after = StreakPublishSystem.headAfter(
    base.published ? base.schedule : null,
    numbered,
    ADMIN_RHYTHM_TRANSITION,
    today,
  );
  return after.ok ? { schedule: after.value.head, published: true } : null;
}

/**
 * The head a withdrawal of `version` leaves behind on `today`
 * (`StreakPublishSystem.withdraw`, the server's own answer): the rule in
 * force, nothing waiting.
 */
function headAfterWithdrawal(
  head: AdminRhythmHead,
  version: number,
  today: LocalDate,
): AdminRhythmHead | null {
  const withdrawn = StreakPublishSystem.withdraw(version, head.schedule, today);
  return withdrawn.ok
    ? { schedule: withdrawn.value.head, published: head.published }
    : null;
}

/** The rule moved under the draft: what the draft was made on, against what the head now holds. */
const staleAgainst = (
  base: AdminRhythmHead | null,
  head: AdminRhythmHead,
): StreakPublishError =>
  StreakPublishError.stale(
    base === null
      ? 0
      : StreakPublishSystem.baseVersionOf(base.schedule, base.published),
    StreakPublishSystem.baseVersionOf(head.schedule, head.published),
  );

const sameDraft = (a: StreakRuleInput, b: StreakRuleInput): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * «РИТЪМ», THE ADMIN PAGE'S STATE (client-card revision 3 §2.6, §3.17):
 * the rule as the shop published it, the DRAFT the form edits, what the
 * draft comes to (its faults, whom the change favours, the first day it
 * may start), the estimate of what it does to the clients, and the rule's
 * history. Provided by the page; the page's sheets read the same one.
 *
 * THE FORM IS A DRAFT. It opens on the rule IN FORCE today (the
 * recommended rule where the shop has published none) and nothing is
 * written until `save()`. A version that waits for its day is shown
 * beside it (`upcoming`), never edited: a new publish replaces it.
 *
 * THE DRAFT REMEMBERS THE HEAD IT WAS MADE ON. The head is watched
 * (`STREAK_DEFINITION_PORTS`), so a rule somebody else publishes arrives by
 * itself: with no draft the form follows it; under a draft the admin's own
 * changes are kept over the new rule, the store says the rule moved
 * (`refusal`: `LOYALTY_STREAK_PUBLISH_STALE`) and the next «Запази» is
 * judged against the new rule, in the open.
 *
 * Every figure is CLAMPED on the way in (`patch`), so the controls cannot
 * reach a rule the domain refuses; the domain's own answer (`validation`,
 * `StreakPublishSystem.assess`) is the second line. A publish is sent as
 * a `StreakPublishCall` through `STREAK_PUBLISH_PORTS` by the browser use
 * cases `publishRhythmDraft` / `withdrawRhythm` (`@core/pipelines`); the
 * store keeps the intent ids, the generation, the floor, rebase / adopt
 * and settling the head the stream says.
 *
 * The preview recomputes by itself, a pause after the last change, over
 * facts read ONCE per visit to the page.
 */
@Injectable()
export class AdminRhythmStore {
  private readonly definitions = inject(STREAK_DEFINITION_PORTS, {
    optional: true,
  });
  private readonly publishing = inject(STREAK_PUBLISH_PORTS, {
    optional: true,
  });
  /** `clientStats` paged by record (D29): the preview's walk. */
  private readonly statsReader = inject(CLIENT_STATS_READ_PORTS, {
    optional: true,
  });
  /** The browser's clock (`CLOCK_PORTS`): read again with every act. */
  private readonly clock = inject(CLOCK_PORTS);
  /** A publish's request id, one per intent (`ID_PORTS`). */
  private readonly ids = inject(ID_PORTS);
  private readonly flags = inject(FLAGS_PORTS);
  /** Where the shop's zone is read (Law 7.2, Phase 4a 4A-11). */
  private readonly shopZones = inject(ShopZoneService);
  private readonly transloco = inject(TranslocoService);
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly facts =
    this.statsReader === null ? null : rhythmPreviewSource(this.statsReader);
  /** «Запази» and «Отмени», the browser use cases over the gateway (`@core/pipelines`). */
  private readonly publishRule =
    this.publishing === null ? null : publishRhythmDraft(this.publishing);
  private readonly withdrawRule =
    this.publishing === null ? null : withdrawRhythm(this.publishing);

  /** `loyalty.streaks`: off, the page still works (the rule is prepared before the rollout) and says so. */
  readonly streaksOn = this.flags.flagOn(FlagName.LoyaltyStreaks);

  /** When a change may start: the server's policy, read from the same flag. */
  readonly policy: StreakNoticePolicy = {
    clientsSeeRhythm: this.flags.flagOn(FlagName.LoyaltySelfView),
    // The notice a stricter rule owes (R29): the ONE figure the server's
    // notice policy shares, so the page never offers a day it refuses.
    noticeDays: StreakRule.RULE_CHANGE_NOTICE_DAYS,
  };

  /** What a publish does to the runs that exist: a value, not a choice, in this round. */
  readonly transition = ADMIN_RHYTHM_TRANSITION;

  /** Bumped when the store is destroyed: an answer that arrives after is dropped. */
  private generation = 0;
  private subscription: Subscription | null = null;
  private headTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Bumped by every change of the draft: a preview of an older draft is dropped. */
  private previewTicket = 0;
  private versionsTicket = 0;
  /** One id per INTENT, kept across retries of it and dropped when the draft moves. */
  private intent: PublishRequestId | null = null;
  private withdrawIntent: PublishRequestId | null = null;
  private saveInFlight: Promise<AdminRhythmSaveOutcome> | null = null;
  private undoInFlight: Promise<AdminRhythmUndoOutcome> | null = null;
  private remembered: RememberedIntervals =
    RhythmDraftSystem.NOTHING_REMEMBERED;

  /** Bumped by every `load`: a zone read of an older one is dropped. */
  private loadTicket = 0;

  private readonly _now = signal(this.readNow());
  /**
   * The shop's zone (Law 7.2, F-4): the rule belongs to no location, so it
   * is the deployment's default location's, read ONCE at the first `load`
   * (`ShopZoneService`) — before the rule is listened to, so no rule is
   * ever judged on a day the page cannot name. `null` until then.
   */
  private readonly _zone = signal<TimeZone | null>(null);
  /** The shop's zone the page words a stamp's day in; `null` until the first `load` has read it. */
  readonly zone: Signal<TimeZone | null> = this._zone.asReadonly();
  private readonly _loadState = signal<LoadState>(LoadState.Loading);
  /** The head as the stream last said it. */
  private readonly _live = signal<AdminRhythmHead | null>(null);
  /** The head the draft was made on. */
  private readonly _base = signal<AdminRhythmHead | null>(null);
  private readonly _draft = signal<StreakRuleInput>(
    draftOf(StreakRule.DEFAULT),
  );
  /** The day the admin chose; `null` = «От утре». */
  private readonly _picked = signal<LocalDate | null>(null);
  /** The earliest day the SERVER allowed a change of this direction, once it has refused an earlier one. */
  private readonly _floor = signal<StreakPublishFloor | null>(null);
  private readonly _preview = signal<LoadSlice<StreakPreview> | null>(null);
  private readonly _previewBusy = signal(false);
  private readonly _previewCapped = signal(false);
  private readonly _versions = signal<
    LoadSlice<readonly StreakDefinitionVersion[]>
  >(LoadSlice.loading);
  private readonly _saving = signal(false);
  private readonly _withdrawing = signal(false);
  /**
   * A «Запази» or an «Отмени» that did not land, worded by its `errorCode`:
   * the server's (or this side's own) `StreakPublishError`, or a request
   * that got no answer (`RepositoryError`). Which is which is
   * `StreakPublishError.guard`'s answer.
   */
  private readonly _refusal = signal<RhythmPublishRefusal | null>(null);
  private readonly _names = signal<
    ReadonlyMap<ServiceId | ServiceCategoryId, string>
  >(new Map());
  private readonly _online = signal(this.window?.navigator.onLine ?? true);

  // ── The rule as published ────────────────────────────────────────────────

  /** The head: the rule in force and the one that waits. Where the shop has published none, the recommended rule. */
  readonly schedule: Signal<LoadSlice<StreakSchedule>> = computed(() => {
    const loadState = this._loadState();
    const head = this._live();
    if (head !== null) {
      return LoadSlice.ready(head.schedule);
    }
    return loadState === LoadState.Failed
      ? LoadSlice.failed
      : LoadSlice.loading;
  });

  /** `false`: the shop has published no rule yet and the form holds the recommended one («Още няма правило»). */
  readonly published = computed(() => this._live()?.published ?? false);

  /**
   * Today, tomorrow and the first of next month, in the shop's zone; `null`
   * until the zone is known (the page's skeleton). The clock is read again
   * with every act; the days move only when the day does, so reading the
   * clock re-judges nothing.
   */
  readonly days: Signal<AdminRhythmDays | null> = computed(
    () => {
      const zone = this._zone();
      if (zone === null) return null;
      return RhythmDraftSystem.effectivePresets(
        ZonedTimeSystem.toLocal(this._now(), zone).localDate,
      );
    },
    { equal: (a, b) => a?.today === b?.today },
  );

  /** The rule clients live under today; `null` until the head has answered. */
  readonly inForce: Signal<StreakHeadRule | null> = computed(() => {
    const head = this._live();
    const days = this.days();
    return head === null || days === null
      ? null
      : StreakRuleSystem.inForceOn(head.schedule, days.today);
  });

  /** The version that waits for its day (with what it will do to the runs, `streakTransition`); `null` when nothing waits. */
  readonly upcoming: Signal<StreakHeadRule | null> = computed(() => {
    const head = this._live();
    const days = this.days();
    return head === null || days === null
      ? null
      : StreakRuleSystem.upcomingOn(head.schedule, days.today);
  });

  /** «История»: the rule's versions, newest first, the withdrawn ones among them. */
  readonly versions = this._versions.asReadonly();

  // ── The draft ────────────────────────────────────────────────────────────

  /** The rule as the form holds it: flat, foreign input until it is published (`StreakRuleInput`). */
  readonly draft = this._draft.asReadonly();

  /** What the draft comes to against the rule in force; `null` until the head has answered. */
  private readonly assessment = computed((): StreakDraftAssessment | null => {
    const base = this._base();
    const days = this.days();
    if (base === null || this.publishing === null || days === null) {
      return null;
    }
    return StreakPublishSystem.assess(
      base.schedule,
      base.published,
      this._draft(),
      this._picked() ?? days.tomorrow,
      days.today,
      this.policy,
    );
  });

  /** The domain's faults with the draft, every one at once (each naming its flat `StreakRuleField`); empty for a draft that is a rule. */
  readonly validation: Signal<readonly EngagementError.StreakRuleError[]> =
    computed(() => {
      const assessment = this.assessment();
      return assessment?.draftAssessment === DraftAssessment.Invalid
        ? assessment.errors
        : [];
    });

  /** What moved against the rule in force, and whom it favours; `null` for a draft that is no rule. */
  readonly change: Signal<StreakRuleChange | null> = computed(() => {
    const assessment = this.assessment();
    return assessment?.draftAssessment === DraftAssessment.Valid
      ? assessment.change
      : null;
  });

  /** The form differs from the rule in force: what «Отхвърли промените?» guards. */
  readonly dirty = computed(() => {
    const assessment = this.assessment();
    return assessment !== null && StreakPublishSystem.isDraftDirty(assessment);
  });

  /**
   * «Влизане в сила» (`StreakPublishSystem.effectiveDay`): the first day
   * this change may start, raised to the server's floor for a change of the
   * same direction, and the day chosen, never earlier; `null` until the
   * shop's days are known.
   */
  private readonly effectiveDays = computed((): StreakEffectiveDay | null => {
    const days = this.days();
    return days === null
      ? null
      : StreakPublishSystem.effectiveDay(
          this._picked(),
          this.assessment(),
          this._floor(),
          days.tomorrow,
        );
  });

  /** The first day this change may start: the day picker's minimum; `null` until the shop's days are known. */
  readonly earliestDay: Signal<LocalDate | null> = computed(
    () => this.effectiveDays()?.earliest ?? null,
  );

  /** The day the draft will be published for: the one chosen, never earlier than the change may start; `null` until the shop's days are known. */
  readonly effectiveFrom: Signal<LocalDate | null> = computed(
    () => this.effectiveDays()?.effectiveFrom ?? null,
  );

  /** The ranges that move with the draft. */
  readonly bounds = computed(() => RhythmDraftSystem.bounds(this._draft()));

  /** «Запази» is in flight. */
  readonly saving = this._saving.asReadonly();

  /** «Отмени» is in flight. */
  readonly withdrawing = this._withdrawing.asReadonly();

  /** The last «Запази» that did not publish, or the rule moving under the draft; `null` once the admin acts again. */
  readonly refusal = this._refusal.asReadonly();

  /** Follows `navigator.onLine`: offline the form still reads and nothing can be saved. */
  readonly online = this._online.asReadonly();

  /**
   * The dock is there: the draft is a rule, there is something to publish
   * (a change, or a shop's first rule as recommended), the browser is
   * online and nothing is in flight.
   */
  readonly canSave = computed(() => {
    const assessment = this.assessment();
    const base = this._base();
    return (
      base !== null &&
      assessment !== null &&
      StreakPublishSystem.publishable(assessment, base.published) &&
      this._online() &&
      !this._saving() &&
      !this._withdrawing()
    );
  });

  // ── The rule, worded ─────────────────────────────────────────────────────

  /**
   * The draft as a rule. While the draft is none (a list with nothing
   * chosen yet) the card keeps the last rule it could word, so this is
   * kept by hand with every change (`judged`): a derived signal is lazy
   * and would remember only what somebody happened to read.
   */
  private readonly _worded = signal<StreakRule>(StreakRule.DEFAULT);

  /**
   * The language the catalogue has loaded, once it has: `translate()` is
   * only ever asked of a loaded language, so no lookup here can start a
   * load (a write) from inside a `computed`.
   */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** The DRAFT's sentences, exactly as the client's card prints a rule; `null` until the catalogue has loaded. */
  readonly rule: Signal<RhythmRuleWords | null> = computed(() =>
    this.wordsOf(this._worded()),
  );

  /** The waiting version's sentences («От 1.10: на всеки 5 седмици»); `null` when nothing waits. */
  readonly upcomingRule: Signal<RhythmRuleWords | null> = computed(() => {
    const upcoming = this.upcoming();
    return upcoming === null ? null : this.wordsOf(upcoming);
  });

  /** One invented client's run under the draft: what the rule card's track draws. `null` under a rule that is off. */
  readonly sample: Signal<StreakState | null> = computed(() => {
    const zone = this._zone();
    const days = this.days();
    return zone === null || days === null
      ? null
      : StreakPreviewSystem.sampleRun(this._worded(), days.today, (day) =>
          ZonedTimeSystem.startOfLocalDay(day, zone),
        );
  });

  // ── The preview ──────────────────────────────────────────────────────────

  /**
   * «Какво ще се промени». `null`: there is nothing to preview (no draft,
   * a draft that is no rule, no statistics to read). `loading` until the
   * first answer; from then on the last answer stays while the next is
   * worked out (`previewBusy`).
   */
  readonly preview = this._preview.asReadonly();

  /** A newer preview is on its way: the card's `aria-busy`. */
  readonly previewBusy = this._previewBusy.asReadonly();

  /** The walk stopped at 1 000 clients with more left: «от първите 1 000 клиенти». */
  readonly previewCapped = this._previewCapped.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const window = this.window;
    if (window !== null) {
      const online = () => this._online.set(true);
      const offline = () => this._online.set(false);
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      destroyRef.onDestroy(() => {
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
      });
    }
    destroyRef.onDestroy(() => {
      this.generation += 1;
      this.stopListening();
      if (this.previewTimer !== null) clearTimeout(this.previewTimer);
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
    });
  }

  // ── What the page does ───────────────────────────────────────────────────

  /**
   * Starts watching the rule and reads its history. Called again, it
   * listens anew and keeps what is on screen until the answer comes.
   */
  load(): void {
    untracked(() => {
      this.stopListening();
      this.tick();
      const definitions = this.definitions;
      if (definitions === null) {
        this._loadState.set(LoadState.Failed);
        this._versions.set(LoadSlice.failed);
        return;
      }
      if (this._live() === null) this._loadState.set(LoadState.Loading);
      const generation = this.generation;
      const ticket = (this.loadTicket += 1);
      this.headTimer = setTimeout(() => {
        this.headTimer = null;
        if (generation === this.generation && this._live() === null) {
          this._loadState.set(LoadState.Failed);
        }
      }, ADMIN_RHYTHM_READ_TIMEOUT_MS);
      void this.listen(generation, ticket, definitions);
      void this.loadVersions();
    });
  }

  /**
   * «Опитай пак»: whatever did not answer is asked again. The rule and
   * its history when the rule failed, the history alone when only it did,
   * and the preview's statistics when the walk failed.
   */
  retry(): void {
    untracked(() => {
      if (this._live() === null) {
        this.load();
      } else if (this._versions().loadState === LoadState.Failed) {
        void this.loadVersions();
      }
      if (this._preview()?.loadState === LoadState.Failed) {
        this.facts?.forget();
        this.previewSoon(0);
      }
    });
  }

  /**
   * A change to the draft, clamped (`patchedRhythmDraft`). Answers the
   * draft as it now stands, so a field that was handed a figure out of
   * range reads the one that was kept.
   */
  patch(partial: AdminRhythmPatch): StreakRuleInput {
    return untracked(() => {
      const held = this._draft();
      if (this._base() === null) return held;
      this.remembered = RhythmDraftSystem.remember(this.remembered, held);
      const next = patchedRhythmDraft(held, partial, this.remembered);
      if (sameDraft(held, next)) return held;
      this._draft.set(next);
      this.moved();
      return next;
    });
  }

  /**
   * «От»: the day the draft is to start on — a day the page's menu or the
   * month picker built (`LocalDate`, parsed at the picker's edge). Answers
   * the day that will be used, which is never earlier than the change may
   * start (`null` until the shop's days are known).
   */
  setEffectiveFrom(day: LocalDate): LocalDate | null {
    return untracked(() => {
      if (day !== this._picked()) {
        this._picked.set(day);
        this.intent = null;
        this._refusal.set(null);
      }
      return this.effectiveFrom();
    });
  }

  /** The services' names by id, for «Броят се посещения с: …». The page hands them over once its catalogue has answered. */
  nameServices(
    names: ReadonlyMap<ServiceId | ServiceCategoryId, string>,
  ): void {
    untracked(() => this._names.set(new Map(names)));
  }

  /** «Отхвърли»: the form goes back to the rule in force, as the stream last said it. */
  discard(): void {
    untracked(() => {
      const head = this._live();
      if (head === null) return;
      this._now.set(this.readNow());
      this._refusal.set(null);
      this.adopt(head);
    });
  }

  /**
   * «Запази». Every answer is one the page words; none is thrown. A
   * second call while one is in flight answers with the first.
   */
  save(): Promise<AdminRhythmSaveOutcome> {
    return untracked(() => {
      this.saveInFlight ??= this.publishDraft().finally(() => {
        this.saveInFlight = null;
      });
      return this.saveInFlight;
    });
  }

  /** «Отмени»: calls off the version that waits. */
  undo(): Promise<AdminRhythmUndoOutcome> {
    return untracked(() => {
      this.undoInFlight ??= this.withdrawWaiting().finally(() => {
        this.undoInFlight = null;
      });
      return this.undoInFlight;
    });
  }

  // ── The head ─────────────────────────────────────────────────────────────

  /**
   * The shop's zone first (read once, then kept), then the rule's stream.
   * A zone that cannot be read is the rule's own failed read (Phase 4a
   * 4A-2 (e)): «Опитай пак» asks for both again.
   */
  private async listen(
    generation: number,
    ticket: number,
    definitions: StreakDefinitionPorts,
  ): Promise<void> {
    if (this._zone() === null) {
      const zone = await this.shopZones.zoneOf(null);
      if (generation !== this.generation || ticket !== this.loadTicket) return;
      if (!zone.ok) {
        if (this._live() === null) {
          this.clearHeadTimer();
          this._loadState.set(LoadState.Failed);
        }
        return;
      }
      this._zone.set(zone.value);
    }
    this.subscription = definitions
      .observeStreakDefinitionHead(StreakRule.DEFAULT_DEFINITION_ID)
      .subscribe({
        next: (head) =>
          this.heard(head.ok ? Result.ok(headOf(head.value)) : head),
        error: () =>
          this.heard(
            Result.err(
              RepositoryError.readFailed(null, "The rule's stream ended"),
            ),
          ),
      });
  }

  /**
   * The shop's days, once the zone is known — read only where a head was
   * heard, which is only ever after the zone (`listen`).
   */
  private shopDays(): AdminRhythmDays {
    return this.days() ?? defect('the shop’s days were read before its zone');
  }

  private heard(head: Result<AdminRhythmHead, RepositoryError>): void {
    if (!head.ok) {
      // A read that fails over an answer keeps the answer: the stream
      // stays open and says the rule again when it can.
      if (this._live() === null) {
        this.clearHeadTimer();
        this._loadState.set(LoadState.Failed);
      }
      return;
    }
    this.clearHeadTimer();
    const before = this._live();
    this._live.set(head.value);
    this._loadState.set(LoadState.Ready);
    if (before !== null && versionsOf(before) !== versionsOf(head.value)) {
      void this.loadVersions();
    }
    // While a write is in flight its answer decides what the head means.
    if (this._saving() || this._withdrawing()) return;
    this.settle(head.value);
  }

  /** A head that arrived by itself: followed, or, under a draft, said. */
  private settle(head: AdminRhythmHead): void {
    const base = this._base();
    if (base !== null && versionsOf(base) === versionsOf(head)) {
      this._base.set(head);
      return;
    }
    if (base === null || !this.dirty()) {
      this.adopt(head);
      return;
    }
    this._refusal.set(staleAgainst(base, head));
    this.rebase(head);
  }

  /** The form opens on this head: its rule in force is the draft. */
  private adopt(head: AdminRhythmHead): void {
    this._base.set(head);
    this._draft.set(
      draftOf(StreakRuleSystem.inForceOn(head.schedule, this.shopDays().today)),
    );
    this._picked.set(null);
    this._floor.set(null);
    this.remembered = RhythmDraftSystem.NOTHING_REMEMBERED;
    this.intent = null;
    this.judged();
  }

  /**
   * The draft is kept and judged against this head from now on. What is
   * kept is what the ADMIN changed (`RhythmDraftSystem.diff`): every
   * parameter they did not touch follows the rule as it now stands, so
   * saving the draft never takes back, unseen, what somebody else
   * published.
   */
  private rebase(head: AdminRhythmHead): void {
    const base = this._base();
    const { today } = this.shopDays();
    if (base !== null) {
      this._draft.set(
        RhythmDraftSystem.carryOver(
          this._draft(),
          StreakRuleSystem.inForceOn(base.schedule, today),
          StreakRuleSystem.inForceOn(head.schedule, today),
          this.remembered,
          ADMIN_RHYTHM_CHOICES.riskLeadDays,
        ),
      );
    }
    this._base.set(head);
    this.intent = null;
    this.judged();
  }

  /** The draft moved: a new intent, no old refusal, a new preview. */
  private moved(): void {
    this.intent = null;
    this._refusal.set(null);
    this.judged();
  }

  /** The draft or the rule it is judged against changed: its words and its preview follow. */
  private judged(): void {
    const assessment = this.assessment();
    if (assessment?.draftAssessment === DraftAssessment.Valid) {
      this._worded.set(assessment.rule);
    }
    this.previewSoon();
  }

  /**
   * Reads the clock. `true` when the day turned AND a version that waited
   * came into force with it: the draft was made on yesterday's rule, so
   * what the admin changed is carried over the rule of today.
   */
  private tick(): boolean {
    const before = this.days()?.today ?? null;
    this._now.set(this.readNow());
    const today = this.days()?.today ?? null;
    const base = this._base();
    if (
      base === null ||
      before === null ||
      today === null ||
      today === before
    ) {
      return false;
    }
    const was = StreakRuleSystem.inForceOn(base.schedule, before);
    const is = StreakRuleSystem.inForceOn(base.schedule, today);
    if (was === is) return false;
    this._draft.set(
      RhythmDraftSystem.carryOver(
        this._draft(),
        was,
        is,
        this.remembered,
        ADMIN_RHYTHM_CHOICES.riskLeadDays,
      ),
    );
    this.intent = null;
    this.judged();
    return true;
  }

  private async loadVersions(): Promise<void> {
    const definitions = this.definitions;
    if (definitions === null) return;
    const ticket = (this.versionsTicket += 1);
    const generation = this.generation;
    if (this._versions().loadState !== LoadState.Ready)
      this._versions.set(LoadSlice.loading);
    const read = await this.timed(() =>
      definitions.listStreakDefinitionVersions(
        StreakRule.DEFAULT_DEFINITION_ID,
        ADMIN_RHYTHM_HISTORY_LIMIT,
      ),
    );
    if (generation !== this.generation || ticket !== this.versionsTicket) {
      return;
    }
    if (read.ok) {
      this._versions.set(LoadSlice.ready(read.value));
    } else if (this._versions().loadState !== LoadState.Ready) {
      this._versions.set(LoadSlice.failed);
    }
  }

  // ── The writes ───────────────────────────────────────────────────────────

  private async publishDraft(): Promise<AdminRhythmSaveOutcome> {
    const base = this._base();
    const publish = this.publishRule;
    if (base === null || publish === null) {
      return Result.err(RepositoryError.unavailable());
    }
    if (this.tick() && this.dirty()) {
      // The rule moved under the draft overnight. Nothing is sent: the
      // form shows the draft over today's rule first, and the next
      // «Запази» publishes what the admin has then seen.
      const stale = staleAgainst(base, base);
      this._refusal.set(stale);
      return Result.err(stale);
    }
    const { today } = this.shopDays();
    const effectiveFrom =
      this.effectiveFrom() ?? defect('a draft judged before its days');
    const assessed = StreakPublishSystem.assess(
      base.schedule,
      base.published,
      this._draft(),
      effectiveFrom,
      today,
      this.policy,
    );
    const requestId = (this.intent ??= this.nextId());
    const generation = this.generation;
    this._refusal.set(null);
    this._saving.set(true);
    // The draft judged here first (no rule, nothing to publish, a day too
    // early — nothing is sent), else the call and its answer in the page's
    // terms; never throws (`publishRhythmDraft`).
    const sent = await publish({
      assessment: assessed,
      published: base.published,
      requestId,
      streakId: StreakRule.DEFAULT_DEFINITION_ID,
      streakTransition: ADMIN_RHYTHM_TRANSITION,
      effectiveFrom,
      today,
      policy: this.policy,
    });
    if (generation !== this.generation) return sent;
    this._saving.set(false);
    // A save that got no answer keeps its id: the retry is the same intent.
    if (sent.ok || StreakPublishError.guard(sent.error)) this.intent = null;

    if (sent.ok) {
      const receipt = sent.value;
      if (
        receipt === null ||
        assessed.draftAssessment !== DraftAssessment.Valid
      ) {
        this.settleAfterWrite();
        return sent;
      }
      const live = this._live();
      const told =
        live !== null &&
        live.published &&
        StreakPublishSystem.newestOf(live.schedule) >= receipt.version;
      const head =
        (told
          ? live
          : (headAfterPublish(base, assessed.rule, receipt, today) ?? live)) ??
        base;
      this._live.set(head);
      this.adopt(head);
      // A head that was heard has read the history already.
      if (!told) void this.loadVersions();
      return sent;
    }

    const refusal = sent.error;
    this._refusal.set(refusal);
    if (
      refusal.errorCode === StreakPublishErrorCode.TooEarly &&
      assessed.draftAssessment === DraftAssessment.Valid
    ) {
      // The day moves to the earliest the server allows (`effectiveFrom`
      // is never under `earliestDay`), and that day stays the floor for
      // a change of this direction. The day the admin chose is kept: a
      // draft that turns the other way goes back to it.
      this._floor.set({
        day: refusal.earliest,
        direction: assessed.change.direction,
      });
    }
    if (refusal.errorCode === StreakPublishErrorCode.Stale) {
      // The refusal IS the notice: the draft is kept and judged against
      // the rule as it now stands.
      const live = this._live();
      if (live !== null) this.rebase(live);
      return sent;
    }
    this.settleAfterWrite();
    return sent;
  }

  private async withdrawWaiting(): Promise<AdminRhythmUndoOutcome> {
    const head = this._live();
    const withdraw = this.withdrawRule;
    if (head === null || withdraw === null) {
      return Result.err(RepositoryError.unavailable());
    }
    this.tick();
    const { today } = this.shopDays();
    const requestId = (this.withdrawIntent ??= this.nextId());
    const generation = this.generation;
    this._withdrawing.set(true);
    // The version that waits on `today`, called off by its own number;
    // nothing is sent when nothing waits; never throws (`withdrawRhythm`).
    const outcome = await withdraw({
      head: head.schedule,
      published: head.published,
      requestId,
      streakId: StreakRule.DEFAULT_DEFINITION_ID,
      today,
    });
    if (generation !== this.generation) return outcome;
    this._withdrawing.set(false);
    if (outcome.ok || StreakPublishError.guard(outcome.error)) {
      this.withdrawIntent = null;
    }

    if (!outcome.ok || outcome.value === null) {
      this.settleAfterWrite();
      return outcome;
    }
    const version = outcome.value;
    const live = this._live();
    const told =
      live !== null &&
      StreakRuleSystem.scheduled(live.schedule)?.version !== version;
    const next =
      (told ? live : (headAfterWithdrawal(head, version, today) ?? live)) ??
      head;
    this._live.set(next);
    // The admin's own act is no news to them: the draft, if there is
    // one, is kept without a word.
    if (this.dirty()) this.rebase(next);
    else this.adopt(next);
    if (!told) void this.loadVersions();
    return outcome;
  }

  /** The heads heard while a write was in flight are read now. */
  private settleAfterWrite(): void {
    const live = this._live();
    if (live !== null) this.settle(live);
  }

  // ── The preview ──────────────────────────────────────────────────────────

  /**
   * The preview, a pause after the last change. The statistics' walk
   * starts AT ONCE (it is made once and takes longer than the pause), the
   * fold waits for the draft to rest.
   */
  private previewSoon(delay = RHYTHM_PREVIEW_DELAY_MS): void {
    this.previewTicket += 1;
    if (this.previewTimer !== null) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    const facts = this.facts;
    const base = this._base();
    const assessment = this.assessment();
    // Nothing to preview unless the draft is a rule that CHANGES something
    // (`publishable` as against a published rule).
    if (
      facts === null ||
      base === null ||
      assessment?.draftAssessment !== DraftAssessment.Valid ||
      !StreakPublishSystem.publishable(assessment, true)
    ) {
      this._preview.set(null);
      this._previewBusy.set(false);
      return;
    }
    const { today } = this.shopDays();
    const inForce = StreakRuleSystem.inForceOn(base.schedule, today);
    const reads = StreakPreviewSystem.readsFacts(inForce, assessment.rule);
    if (reads && facts.failed()) {
      // The walk failed and nobody asked for it again: the notice stays,
      // with no skeleton in between, until «Опитай пак».
      this._preview.set(LoadSlice.failed);
      this._previewBusy.set(false);
      return;
    }
    if (this._preview()?.loadState !== LoadState.Ready)
      this._preview.set(LoadSlice.loading);
    this._previewBusy.set(true);
    if (reads) void facts.read(this.shopZone());
    const ticket = this.previewTicket;
    const generation = this.generation;
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.previewNow(ticket, generation);
    }, delay);
  }

  private async previewNow(ticket: number, generation: number): Promise<void> {
    const stale = () =>
      ticket !== this.previewTicket || generation !== this.generation;
    const facts = this.facts;
    const base = this._base();
    const assessment = this.assessment();
    if (stale() || facts === null || base === null) return;
    if (assessment?.draftAssessment !== DraftAssessment.Valid) return;
    const { today } = this.shopDays();
    const inForce = StreakRuleSystem.inForceOn(base.schedule, today);
    const draft = assessment.rule;
    const zone = this.shopZone();

    if (!StreakPreviewSystem.readsFacts(inForce, draft)) {
      this._preview.set(
        LoadSlice.ready(
          rhythmPreviewOf({
            inForce,
            draft,
            facts: { clients: [], capped: false },
            today,
          }),
        ),
      );
      this._previewCapped.set(false);
      this._previewBusy.set(false);
      return;
    }
    const read = await this.timed(() => facts.read(zone));
    if (stale()) return;
    if (!read.ok) {
      // The answer on screen is about another draft: it goes.
      this._preview.set(LoadSlice.failed);
      this._previewBusy.set(false);
      return;
    }
    this._preview.set(
      LoadSlice.ready(
        rhythmPreviewOf({ inForce, draft, facts: read.value, today }),
      ),
    );
    this._previewCapped.set(read.value.capped);
    this._previewBusy.set(false);
  }

  // ── Support ──────────────────────────────────────────────────────────────

  private wordsOf(rule: StreakRule): RhythmRuleWords | null {
    const lang = this.loadedLang();
    if (lang === null) return null;
    const names = this._names();
    return rhythmRuleWords(
      StreakRuleSystem.summary(rule),
      (key, params) => this.transloco.translate(key, params, lang),
      lang,
      { nameOf: (id) => names.get(id) ?? null },
    );
  }

  /** The instant now (`CLOCK_PORTS`); the days are read off it in the shop's zone (`days`). */
  private readNow(): UtcEpochMs {
    return this.clock.nowUtcMs();
  }

  /** The shop's zone, once known — read only where a head was heard (`listen`). */
  private shopZone(): TimeZone {
    return (
      this._zone() ?? defect('the shop’s zone was read before it was known')
    );
  }

  private nextId(): PublishRequestId {
    return PublishRequestId.of(this.ids.nextId());
  }

  private stopListening(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.clearHeadTimer();
  }

  private clearHeadTimer(): void {
    if (this.headTimer === null) return;
    clearTimeout(this.headTimer);
    this.headTimer = null;
  }

  /**
   * The read, or a failure after `ADMIN_RHYTHM_READ_TIMEOUT_MS`; a thrown
   * error is a failure too — each a `RepositoryError` struct (Law 7.5),
   * never a bare tag.
   */
  private timed<T, E>(
    read: () => Promise<Result<T, E>>,
  ): Promise<Result<T, E | RepositoryError>> {
    return timedRead(
      read,
      ADMIN_RHYTHM_READ_TIMEOUT_MS,
      this.timers,
      READ_FAILURES,
    );
  }
}
