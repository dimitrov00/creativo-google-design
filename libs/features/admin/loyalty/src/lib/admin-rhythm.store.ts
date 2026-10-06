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
import { map, switchMap } from 'rxjs/operators';
import {
  CLIENT_STATS_DIRECTORY,
  type Result,
  ZonedDateTime,
  fail,
} from '@creativo/application/booking';
import {
  type IsoDate,
  type ObservedStreakDefinition,
  ObserveStreakDefinitionUseCase,
  type PublishOutcome,
  PublishStreakDefinitionUseCase,
  STREAK_DEFINITION_REPOSITORY,
  STREAK_EXCUSES,
  STREAK_LIMITS,
  type StreakDefinitionError,
  StreakDefinition,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  type StreakDefinitionVersion,
  type StreakDraftAssessment,
  type StreakExcuse,
  type StreakIntervalProps,
  type StreakNoticePolicy,
  type StreakPreview,
  type StreakQualifierProps,
  type StreakRuleChange,
  type StreakRuleDirection,
  type StreakState,
  type StreakTransition,
  type WithdrawOutcome,
} from '@creativo/application/engagement';
import {
  CLOCK,
  FEATURE_FLAGS,
  ID_GENERATOR,
  RepositoryError,
} from '@creativo/application/shared';
import {
  type RhythmRuleWords,
  rhythmRuleWords,
} from '@creativo/features/shared/visits';
import {
  RHYTHM_PREVIEW_DELAY_MS,
  RhythmPreviewSource,
  rhythmPreviewOf,
  rhythmPreviewReadsFacts,
  sampleRhythmRun,
} from './admin-rhythm.preview';

// ── What the page reads ────────────────────────────────────────────────────

/**
 * One read as the page draws it: a skeleton, the content, or «Опитай пак».
 * The client card's three states (`client-card.vm.ts`), which a feature
 * cannot import from another feature.
 */
export type Slice<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'failed' };

/** The business has ONE rhythm rule (§4.1): the recommended rule's id. */
export const ADMIN_RHYTHM_STREAK_ID = StreakDefinition.default().id;

/** A read that has not answered by then counts as failed. */
export const ADMIN_RHYTHM_READ_TIMEOUT_MS = 10_000;

/**
 * The notice a stricter rule owes the clients once they see the rhythm
 * (R29). The SERVER's figure (`RULE_CHANGE_NOTICE_DAYS`), held here to the
 * same, so the page never offers a day the server refuses.
 */
export const ADMIN_RHYTHM_NOTICE_DAYS = 30;

/** What the new rule does to the runs that exist. «Преизчисляват се» needs the engine and is not offered. */
export const ADMIN_RHYTHM_TRANSITION: StreakTransition = 'grandfather';

/**
 * What the page's menus offer (§2.6.2 P7, P8b, P10, P11). The domain
 * allows every whole number of a range; a menu shows a few of them, and
 * the store snaps to one of THESE where a figure it did not ask for has to
 * move (the cue, when the interval shrinks under it).
 */
export const ADMIN_RHYTHM_CHOICES = {
  riskLeadDays: [0, 3, 7, 14],
  earnEvery: [3, 4, 5, 6, 8, 10],
  pauseDaysPerYear: [30, 60, 90],
  repairWindowDays: [7, 14, 21, 30],
  repairPerYear: [1, 2, 3],
} as const;

/** The personal interval a rule opens on when the admin first chooses it (§2.6.2 P5b, P5c). */
const RECOMMENDED_PERSONAL = {
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
} as const;

interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * The interval, as the page changes it: the kind, and whichever of its
 * figures moved. Naming a kind the draft does not have SWITCHES to it.
 */
export type AdminRhythmIntervalPatch =
  | { readonly kind: 'fixed'; readonly days?: number }
  | {
      readonly kind: 'personal';
      readonly tolerancePct?: number;
      readonly minDays?: number;
      readonly maxDays?: number;
      readonly fallbackDays?: number;
    };

/**
 * A change to the draft: any parameter of the rule, any figure of a part.
 * A version's identity (`id`, `name`, `version`, `effectiveFrom`) is not
 * the form's to say and is not here.
 */
export interface AdminRhythmPatch {
  readonly enabled?: boolean;
  readonly qualifier?: StreakQualifierProps;
  readonly minGapDays?: number;
  readonly bookingHold?: Readonly<
    Partial<StreakDefinitionProps['bookingHold']>
  >;
  readonly interval?: AdminRhythmIntervalPatch;
  readonly graceDays?: number;
  readonly riskLeadDays?: number;
  readonly protections?: Readonly<
    Partial<StreakDefinitionProps['protections']>
  >;
  readonly excuses?: readonly StreakExcuse[];
  readonly clientPause?: Readonly<
    Partial<StreakDefinitionProps['clientPause']>
  >;
  readonly repair?: Readonly<Partial<StreakDefinitionProps['repair']>>;
  readonly onBreak?: StreakDefinitionProps['onBreak'];
}

/** The last interval of each kind the draft held, so switching the kind and back loses nothing typed. */
export type RememberedIntervals = {
  readonly [K in StreakIntervalProps['kind']]?: Extract<
    StreakIntervalProps,
    { kind: K }
  >;
};

/**
 * The ranges that MOVE with the draft, for the controls that show a
 * maximum: grace, the cue and the minimum gap stay under the shortest
 * interval, nobody starts with more protections than the reserve holds,
 * and the newcomer's interval stays inside the clamp. Every other range is
 * `STREAK_LIMITS`, which does not move.
 */
export interface AdminRhythmBounds {
  readonly graceDays: Range;
  readonly riskLeadDays: Range;
  readonly minGapDays: Range;
  readonly startWith: Range;
  /** Under a personal interval: the clamp itself. Under a fixed one: the interval's whole range. */
  readonly fallbackDays: Range;
}

/** A «Запази» that did not publish, as the page words it until the admin acts again. */
export type AdminRhythmRefusal = Exclude<
  PublishOutcome,
  { readonly kind: 'published' | 'unchanged' }
>;

/** The three days «Влизане в сила» names. */
export interface AdminRhythmDays {
  readonly today: IsoDate;
  readonly tomorrow: IsoDate;
  /** The first day of the month after this one. */
  readonly firstOfMonth: IsoDate;
}

// ── The draft, clamped ─────────────────────────────────────────────────────

const within = (value: number, range: Range): number =>
  Math.min(range.max, Math.max(range.min, value));

/** A figure as the rule holds one: whole, inside its range. What is no number leaves the figure as it was. */
const figure = (
  typed: number | undefined,
  held: number,
  range: Range,
): number =>
  within(
    typed !== undefined && Number.isFinite(typed) ? Math.round(typed) : held,
    range,
  );

const shortestOf = (interval: StreakIntervalProps): number =>
  interval.kind === 'fixed' ? interval.days : interval.minDays;

/** A range of the rule, held under the shortest interval. */
const under = (range: Range, interval: StreakIntervalProps): Range => ({
  min: range.min,
  max: Math.max(range.min, Math.min(range.max, shortestOf(interval) - 1)),
});

function intervalOf(
  held: StreakIntervalProps,
  patch: AdminRhythmIntervalPatch | undefined,
  remembered: RememberedIntervals,
): StreakIntervalProps {
  if (patch === undefined) return held;
  const { days, tolerancePct } = STREAK_LIMITS.interval;
  if (patch.kind === 'fixed') {
    // Coming from a personal interval, the one number closest to it is
    // the newcomer's: what the rule already gave someone it did not know.
    const from =
      held.kind === 'fixed'
        ? held.days
        : (remembered.fixed?.days ?? held.fallbackDays);
    return { kind: 'fixed', days: figure(patch.days, from, days) };
  }
  const from =
    held.kind === 'personal'
      ? held
      : (remembered.personal ?? {
          ...RECOMMENDED_PERSONAL,
          fallbackDays: held.days,
        });
  let minDays = figure(patch.minDays, from.minDays, days);
  let maxDays = figure(patch.maxDays, from.maxDays, days);
  // The figure in hand wins and the other end of the clamp follows it: a
  // floor typed above the ceiling lifts the ceiling, a ceiling typed
  // under the floor lowers the floor.
  if (minDays > maxDays) {
    if (patch.maxDays !== undefined) minDays = maxDays;
    else maxDays = minDays;
  }
  return {
    kind: 'personal',
    tolerancePct: figure(patch.tolerancePct, from.tolerancePct, tolerancePct),
    minDays,
    maxDays,
    fallbackDays: figure(patch.fallbackDays, from.fallbackDays, {
      min: minDays,
      max: maxDays,
    }),
  };
}

/** The cue under its bound: as typed when it fits, else the longest the menu offers that does. */
function riskLeadOf(
  typed: number | undefined,
  held: number,
  range: Range,
): number {
  const asked =
    typed !== undefined && Number.isFinite(typed) ? Math.round(typed) : held;
  if (asked <= range.max) return Math.max(range.min, asked);
  const offered = ADMIN_RHYTHM_CHOICES.riskLeadDays.filter(
    (days) => days <= range.max,
  );
  return offered.length > 0 ? Math.max(...offered) : range.max;
}

/**
 * The draft with a change over it, CLAMPED: every figure whole and inside
 * the domain's range (`STREAK_LIMITS`, the table `StreakDefinition.create`
 * refuses by), and what depends on another figure held to it, so no
 * combination the controls can reach is one the domain refuses (§2.6.4).
 *
 * The figure in hand wins; what depends on it follows. A shorter interval
 * pulls grace, the cue and the minimum gap under it; a smaller reserve
 * pulls what a run starts with; the clamp's two ends push each other and
 * the newcomer's interval stays between them.
 *
 * What it cannot mend is a LIST: «Посещение с избрани услуги» with no
 * service chosen yet is no rule, and the store says so (`validation`)
 * until one is.
 */
export function patchedRhythmDraft(
  draft: StreakDefinitionProps,
  patch: AdminRhythmPatch,
  remembered: RememberedIntervals = {},
): StreakDefinitionProps {
  const limits = STREAK_LIMITS;
  const interval = intervalOf(draft.interval, patch.interval, remembered);
  const maxBanked = figure(
    patch.protections?.maxBanked,
    draft.protections.maxBanked,
    limits.protections.maxBanked,
  );
  return {
    id: draft.id,
    name: { ...draft.name },
    version: draft.version,
    effectiveFrom: draft.effectiveFrom,
    enabled: patch.enabled ?? draft.enabled,
    qualifier: qualifierOf(patch.qualifier ?? draft.qualifier),
    minGapDays: figure(
      patch.minGapDays,
      draft.minGapDays,
      under(limits.minGapDays, interval),
    ),
    bookingHold: {
      enabled: patch.bookingHold?.enabled ?? draft.bookingHold.enabled,
      maxDaysPastDue: figure(
        patch.bookingHold?.maxDaysPastDue,
        draft.bookingHold.maxDaysPastDue,
        limits.bookingHold.maxDaysPastDue,
      ),
    },
    interval,
    graceDays: figure(
      patch.graceDays,
      draft.graceDays,
      under(limits.graceDays, interval),
    ),
    riskLeadDays: riskLeadOf(
      patch.riskLeadDays,
      draft.riskLeadDays,
      under(limits.riskLeadDays, interval),
    ),
    protections: {
      enabled: patch.protections?.enabled ?? draft.protections.enabled,
      maxBanked,
      earnEvery: figure(
        patch.protections?.earnEvery,
        draft.protections.earnEvery,
        limits.protections.earnEvery,
      ),
      startWith: figure(
        patch.protections?.startWith,
        draft.protections.startWith,
        {
          min: limits.protections.startWith.min,
          max: Math.min(limits.protections.startWith.max, maxBanked),
        },
      ),
    },
    excuses: STREAK_EXCUSES.filter((excuse) =>
      (patch.excuses ?? draft.excuses).includes(excuse),
    ),
    clientPause: {
      enabled: patch.clientPause?.enabled ?? draft.clientPause.enabled,
      maxDaysPerYear: figure(
        patch.clientPause?.maxDaysPerYear,
        draft.clientPause.maxDaysPerYear,
        limits.clientPause.maxDaysPerYear,
      ),
    },
    repair: {
      enabled: patch.repair?.enabled ?? draft.repair.enabled,
      windowDays: figure(
        patch.repair?.windowDays,
        draft.repair.windowDays,
        limits.repair.windowDays,
      ),
      perYear: figure(
        patch.repair?.perYear,
        draft.repair.perYear,
        limits.repair.perYear,
      ),
    },
    onBreak: patch.onBreak ?? draft.onBreak,
  };
}

/** A copy of the choice: the draft never shares a list with whoever handed it over. */
function qualifierOf(qualifier: StreakQualifierProps): StreakQualifierProps {
  switch (qualifier.kind) {
    case 'anyVisit':
      return { kind: 'anyVisit' };
    case 'services':
      return { kind: 'services', serviceIds: [...qualifier.serviceIds] };
    case 'categories':
      return { kind: 'categories', categoryIds: [...qualifier.categoryIds] };
  }
}

/** The ranges that move with the draft. */
export function rhythmBoundsOf(
  draft: StreakDefinitionProps,
): AdminRhythmBounds {
  const limits = STREAK_LIMITS;
  const { interval } = draft;
  return {
    graceDays: under(limits.graceDays, interval),
    riskLeadDays: under(limits.riskLeadDays, interval),
    minGapDays: under(limits.minGapDays, interval),
    startWith: {
      min: limits.protections.startWith.min,
      max: Math.min(
        limits.protections.startWith.max,
        draft.protections.maxBanked,
      ),
    },
    fallbackDays:
      interval.kind === 'personal'
        ? { min: interval.minDays, max: interval.maxDays }
        : limits.interval.days,
  };
}

// ── The head, told apart ───────────────────────────────────────────────────

/** Which versions a head holds: two heads that answer the same hold the same rule. */
const versionsOf = (head: ObservedStreakDefinition): string =>
  [
    head.published ? 'published' : 'recommended',
    head.schedule.current.version,
    head.schedule.scheduled?.definition.version ?? 0,
  ].join(':');

const newestOf = (head: ObservedStreakDefinition): number =>
  head.schedule.scheduled?.definition.version ?? head.schedule.current.version;

/**
 * The head a publish leaves behind, worked out from its answer: what the
 * page stands on until the stream says the same. In force at once when
 * its day has come (and always for a shop's first rule), else waiting
 * beside the rule in force.
 */
function headAfterPublish(
  base: ObservedStreakDefinition,
  assessed: StreakDefinition,
  published: Extract<PublishOutcome, { readonly kind: 'published' }>,
  today: IsoDate,
): ObservedStreakDefinition | null {
  const numbered = StreakDefinition.create({
    ...assessed.toProps(),
    version: published.version,
    effectiveFrom: published.effectiveFrom,
  });
  if (numbered.isFailure()) return null;
  const schedule = StreakDefinitionSchedule.create(
    base.published && published.waits
      ? {
          current: base.schedule.inForceOn(today),
          scheduled: {
            definition: numbered.value,
            transition: ADMIN_RHYTHM_TRANSITION,
          },
        }
      : { current: numbered.value, scheduled: null },
  );
  return schedule.isFailure()
    ? null
    : { schedule: schedule.value, published: true };
}

/** The head a withdrawal leaves behind: the rule in force, nothing waiting. */
function headAfterWithdrawal(
  head: ObservedStreakDefinition,
): ObservedStreakDefinition | null {
  const schedule = StreakDefinitionSchedule.create({
    current: head.schedule.current,
    scheduled: null,
  });
  return schedule.isFailure()
    ? null
    : { schedule: schedule.value, published: head.published };
}

const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

const SHOP_ZONE = 'Europe/Sofia';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day that exists, as the rule holds one: `YYYY-MM-DD`. */
const isDay = (day: string): boolean =>
  ISO_DAY.test(day) && ZonedDateTime.fromISO(day, SHOP_ZONE).isSuccess();

const LOADING: Slice<never> = { status: 'loading' };
const FAILED: Slice<never> = { status: 'failed' };
const STALE: AdminRhythmRefusal = { kind: 'refused', refusal: 'stale' };

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const sameDraft = (
  a: StreakDefinitionProps,
  b: StreakDefinitionProps,
): boolean => same(a, b);

/**
 * The parameters of a draft that differ from the rule it was made on, as
 * the change that made them: what the admin did, apart from what the rule
 * already said.
 */
function touchedOf(
  draft: StreakDefinitionProps,
  madeOn: StreakDefinitionProps,
): AdminRhythmPatch {
  return {
    ...(draft.enabled === madeOn.enabled ? {} : { enabled: draft.enabled }),
    ...(same(draft.qualifier, madeOn.qualifier)
      ? {}
      : { qualifier: draft.qualifier }),
    ...(draft.minGapDays === madeOn.minGapDays
      ? {}
      : { minGapDays: draft.minGapDays }),
    ...(same(draft.bookingHold, madeOn.bookingHold)
      ? {}
      : { bookingHold: draft.bookingHold }),
    ...(same(draft.interval, madeOn.interval)
      ? {}
      : { interval: draft.interval }),
    ...(draft.graceDays === madeOn.graceDays
      ? {}
      : { graceDays: draft.graceDays }),
    ...(draft.riskLeadDays === madeOn.riskLeadDays
      ? {}
      : { riskLeadDays: draft.riskLeadDays }),
    ...(same(draft.protections, madeOn.protections)
      ? {}
      : { protections: draft.protections }),
    ...(same(draft.excuses, madeOn.excuses) ? {} : { excuses: draft.excuses }),
    ...(same(draft.clientPause, madeOn.clientPause)
      ? {}
      : { clientPause: draft.clientPause }),
    ...(same(draft.repair, madeOn.repair) ? {} : { repair: draft.repair }),
    ...(draft.onBreak === madeOn.onBreak ? {} : { onBreak: draft.onBreak }),
  };
}

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
 * THE DRAFT REMEMBERS THE HEAD IT WAS MADE ON. The head is watched, so a
 * rule somebody else publishes arrives by itself: with no draft the form
 * follows it; under a draft the admin's own changes are kept over the new
 * rule, the store says the rule moved (`refusal`: `stale`) and the next
 * «Запази» is judged against the new rule, in the open.
 *
 * Every figure is CLAMPED on the way in (`patch`), so the controls cannot
 * reach a rule the domain refuses; the domain's own answer (`validation`)
 * is the second line.
 *
 * The preview recomputes by itself, a pause after the last change, over
 * facts read ONCE per visit to the page.
 */
@Injectable()
export class AdminRhythmStore {
  private readonly definitions = inject(STREAK_DEFINITION_REPOSITORY, {
    optional: true,
  });
  private readonly directory = inject(CLIENT_STATS_DIRECTORY, {
    optional: true,
  });
  private readonly clock = inject(CLOCK, { optional: true });
  private readonly ids = inject(ID_GENERATOR, { optional: true });
  private readonly flags = inject(FEATURE_FLAGS, { optional: true });
  private readonly transloco = inject(TranslocoService);
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly observing =
    this.definitions === null
      ? null
      : new ObserveStreakDefinitionUseCase(this.definitions);
  private readonly publishing =
    this.definitions === null
      ? null
      : new PublishStreakDefinitionUseCase(this.definitions);
  private readonly facts =
    this.directory === null ? null : new RhythmPreviewSource(this.directory);

  /** `loyalty.streaks`: off, the page still works (the rule is prepared before the rollout) and says so. */
  readonly streaksOn = this.flags?.isEnabled('loyalty.streaks') ?? false;

  /** When a change may start: the server's policy, read from the same flag. */
  readonly policy: StreakNoticePolicy = {
    clientsSeeRhythm: this.flags?.isEnabled('loyalty.selfView') ?? false,
    noticeDays: ADMIN_RHYTHM_NOTICE_DAYS,
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
  private intent: string | null = null;
  private withdrawIntent: string | null = null;
  private saveInFlight: Promise<PublishOutcome> | null = null;
  private undoInFlight: Promise<WithdrawOutcome> | null = null;
  private remembered: RememberedIntervals = {};

  private readonly _now = signal(this.readNow());
  private readonly _status = signal<Slice<unknown>['status']>('loading');
  /** The head as the stream last said it. */
  private readonly _live = signal<ObservedStreakDefinition | null>(null);
  /** The head the draft was made on. */
  private readonly _base = signal<ObservedStreakDefinition | null>(null);
  private readonly _draft = signal<StreakDefinitionProps>(
    StreakDefinition.default().toProps(),
  );
  /** The day the admin chose; `null` = «От утре». */
  private readonly _picked = signal<IsoDate | null>(null);
  /** The earliest day the SERVER allowed a change of this direction, once it has refused an earlier one. */
  private readonly _floor = signal<{
    readonly day: IsoDate;
    readonly direction: StreakRuleDirection;
  } | null>(null);
  private readonly _preview = signal<Slice<StreakPreview> | null>(null);
  private readonly _previewBusy = signal(false);
  private readonly _previewCapped = signal(false);
  private readonly _versions =
    signal<Slice<readonly StreakDefinitionVersion[]>>(LOADING);
  private readonly _saving = signal(false);
  private readonly _withdrawing = signal(false);
  private readonly _refusal = signal<AdminRhythmRefusal | null>(null);
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _online = signal(this.window?.navigator.onLine ?? true);

  // ── The rule as published ────────────────────────────────────────────────

  /** The head: the rule in force and the one that waits. Where the shop has published none, the recommended rule. */
  readonly schedule: Signal<Slice<StreakDefinitionSchedule>> = computed(() => {
    const status = this._status();
    const head = this._live();
    if (head !== null) return { status: 'ready', data: head.schedule };
    return status === 'failed' ? FAILED : LOADING;
  });

  /** `false`: the shop has published no rule yet and the form holds the recommended one («Още няма правило»). */
  readonly published = computed(() => this._live()?.published ?? false);

  /**
   * Today, tomorrow and the first of next month, in the shop's zone. The
   * clock is read again with every act; the days move only when the day
   * does, so reading the clock re-judges nothing.
   */
  readonly days: Signal<AdminRhythmDays> = computed(
    () => {
      const now = this._now();
      return {
        today: now.toISODate(),
        tomorrow: now.plusDays(1).toISODate(),
        firstOfMonth: now.startOfMonth().plusMonths(1).toISODate(),
      };
    },
    { equal: (a, b) => a.today === b.today },
  );

  /** The rule clients live under today; `null` until the head has answered. */
  readonly inForce = computed(
    () => this._live()?.schedule.inForceOn(this.days().today) ?? null,
  );

  /** The version that waits for its day, and what it will do to the runs; `null` when nothing waits. */
  readonly upcoming = computed(
    () => this._live()?.schedule.upcomingOn(this.days().today) ?? null,
  );

  /** «История»: the rule's versions, newest first, the withdrawn ones among them. */
  readonly versions = this._versions.asReadonly();

  // ── The draft ────────────────────────────────────────────────────────────

  /** The rule as the form holds it. */
  readonly draft = this._draft.asReadonly();

  /** What the draft comes to against the rule in force; `null` until the head has answered. */
  private readonly assessment = computed((): StreakDraftAssessment | null => {
    const base = this._base();
    const publishing = this.publishing;
    if (base === null || publishing === null) return null;
    const days = this.days();
    return publishing.assess({
      observed: base,
      draft: this._draft(),
      effectiveFrom: this._picked() ?? days.tomorrow,
      today: days.today,
      policy: this.policy,
    });
  });

  /** The domain's faults with the draft, every one at once; empty for a draft that is a rule. */
  readonly validation: Signal<readonly StreakDefinitionError[]> = computed(
    () => {
      const assessment = this.assessment();
      return assessment?.kind === 'invalid' ? assessment.errors : [];
    },
  );

  /** What moved against the rule in force, and whom it favours; `null` for a draft that is no rule. */
  readonly change: Signal<StreakRuleChange | null> = computed(() => {
    const assessment = this.assessment();
    return assessment?.kind === 'valid' ? assessment.change : null;
  });

  /** The form differs from the rule in force: what «Отхвърли промените?» guards. */
  readonly dirty = computed(() => {
    const assessment = this.assessment();
    return (
      assessment !== null &&
      (assessment.kind === 'invalid' || assessment.change.changed.length > 0)
    );
  });

  /** The first day this change may start: the day picker's minimum. */
  readonly earliestDay: Signal<IsoDate> = computed(() => {
    const assessment = this.assessment();
    if (assessment?.kind !== 'valid') return this.days().tomorrow;
    const floor = this._floor();
    return floor !== null && floor.direction === assessment.change.direction
      ? laterOf(floor.day, assessment.earliest)
      : assessment.earliest;
  });

  /** The day the draft will be published for: the one chosen, never earlier than the change may start. */
  readonly effectiveFrom: Signal<IsoDate> = computed(() =>
    laterOf(this._picked() ?? this.days().tomorrow, this.earliestDay()),
  );

  /** The ranges that move with the draft. */
  readonly bounds: Signal<AdminRhythmBounds> = computed(() =>
    rhythmBoundsOf(this._draft()),
  );

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
      assessment?.kind === 'valid' &&
      (assessment.change.changed.length > 0 || !base.published) &&
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
  private readonly _worded = signal(StreakDefinition.default());

  /**
   * The language the catalogue has loaded, once it has: `translate()` is
   * only ever asked of a loaded language, so no lookup here can start a
   * load (a write) from inside a `computed`.
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  /** The DRAFT's sentences, exactly as the client's card prints a rule; `null` until the catalogue has loaded. */
  readonly rule: Signal<RhythmRuleWords | null> = computed(() =>
    this.wordsOf(this._worded()),
  );

  /** The waiting version's sentences («От 1.10: на всеки 5 седмици»); `null` when nothing waits. */
  readonly upcomingRule: Signal<RhythmRuleWords | null> = computed(() => {
    const upcoming = this.upcoming();
    return upcoming === null ? null : this.wordsOf(upcoming.definition);
  });

  /** One invented client's run under the draft: what the rule card's track draws. `null` under a rule that is off. */
  readonly sample: Signal<StreakState | null> = computed(() =>
    sampleRhythmRun(this._worded(), this.days().today),
  );

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
      const observing = this.observing;
      if (observing === null) {
        this._status.set('failed');
        this._versions.set(FAILED);
        return;
      }
      if (this._live() === null) this._status.set('loading');
      const generation = this.generation;
      this.headTimer = setTimeout(() => {
        this.headTimer = null;
        if (generation === this.generation && this._live() === null) {
          this._status.set('failed');
        }
      }, ADMIN_RHYTHM_READ_TIMEOUT_MS);
      this.subscription = observing.execute(ADMIN_RHYTHM_STREAK_ID).subscribe({
        next: (head) => this.heard(head),
        error: (error: unknown) =>
          this.heard(
            fail(new RepositoryError("The rule's stream ended", error)),
          ),
      });
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
      } else if (this._versions().status === 'failed') {
        void this.loadVersions();
      }
      if (this._preview()?.status === 'failed') {
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
  patch(partial: AdminRhythmPatch): StreakDefinitionProps {
    return untracked(() => {
      const held = this._draft();
      if (this._base() === null) return held;
      this.remembered =
        held.interval.kind === 'fixed'
          ? { ...this.remembered, fixed: held.interval }
          : { ...this.remembered, personal: held.interval };
      const next = patchedRhythmDraft(held, partial, this.remembered);
      if (sameDraft(held, next)) return held;
      this._draft.set(next);
      this.moved();
      return next;
    });
  }

  /**
   * «От»: the day the draft is to start on. Answers the day that will be
   * used, which is never earlier than the change may start. What is no
   * day changes nothing.
   */
  setEffectiveFrom(day: IsoDate): IsoDate {
    return untracked(() => {
      if (isDay(day) && day !== this._picked()) {
        this._picked.set(day);
        this.intent = null;
        this._refusal.set(null);
      }
      return this.effectiveFrom();
    });
  }

  /** The services' names by id, for «Броят се посещения с: …». The page hands them over once its catalogue has answered. */
  nameServices(names: ReadonlyMap<string, string>): void {
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
  save(): Promise<PublishOutcome> {
    return untracked(() => {
      this.saveInFlight ??= this.publishDraft().finally(() => {
        this.saveInFlight = null;
      });
      return this.saveInFlight;
    });
  }

  /** «Отмени»: calls off the version that waits. */
  undo(): Promise<WithdrawOutcome> {
    return untracked(() => {
      this.undoInFlight ??= this.withdrawWaiting().finally(() => {
        this.undoInFlight = null;
      });
      return this.undoInFlight;
    });
  }

  // ── The head ─────────────────────────────────────────────────────────────

  private heard(head: Result<ObservedStreakDefinition, RepositoryError>): void {
    if (head.isFailure()) {
      // A read that fails over an answer keeps the answer: the stream
      // stays open and says the rule again when it can.
      if (this._live() === null) {
        this.clearHeadTimer();
        this._status.set('failed');
      }
      return;
    }
    this.clearHeadTimer();
    const before = this._live();
    this._live.set(head.value);
    this._status.set('ready');
    if (before !== null && versionsOf(before) !== versionsOf(head.value)) {
      void this.loadVersions();
    }
    // While a write is in flight its answer decides what the head means.
    if (this._saving() || this._withdrawing()) return;
    this.settle(head.value);
  }

  /** A head that arrived by itself: followed, or, under a draft, said. */
  private settle(head: ObservedStreakDefinition): void {
    const base = this._base();
    if (base !== null && versionsOf(base) === versionsOf(head)) {
      this._base.set(head);
      return;
    }
    if (base === null || !this.dirty()) {
      this.adopt(head);
      return;
    }
    this._refusal.set(STALE);
    this.rebase(head);
  }

  /** The form opens on this head: its rule in force is the draft. */
  private adopt(head: ObservedStreakDefinition): void {
    this._base.set(head);
    this._draft.set(head.schedule.inForceOn(this.days().today).toProps());
    this._picked.set(null);
    this._floor.set(null);
    this.remembered = {};
    this.intent = null;
    this.judged();
  }

  /**
   * The draft is kept and judged against this head from now on. What is
   * kept is what the ADMIN changed: every parameter they did not touch
   * follows the rule as it now stands, so saving the draft never takes
   * back, unseen, what somebody else published.
   */
  private rebase(head: ObservedStreakDefinition): void {
    const base = this._base();
    const { today } = this.days();
    if (base !== null) {
      this._draft.set(
        patchedRhythmDraft(
          head.schedule.inForceOn(today).toProps(),
          touchedOf(this._draft(), base.schedule.inForceOn(today).toProps()),
          this.remembered,
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
    if (assessment?.kind === 'valid') this._worded.set(assessment.definition);
    this.previewSoon();
  }

  /**
   * Reads the clock. `true` when the day turned AND a version that waited
   * came into force with it: the draft was made on yesterday's rule, so
   * what the admin changed is carried over the rule of today.
   */
  private tick(): boolean {
    const before = this.days().today;
    this._now.set(this.readNow());
    const { today } = this.days();
    const base = this._base();
    if (base === null || today === before) return false;
    const was = base.schedule.inForceOn(before);
    const is = base.schedule.inForceOn(today);
    if (was === is) return false;
    this._draft.set(
      patchedRhythmDraft(
        is.toProps(),
        touchedOf(this._draft(), was.toProps()),
        this.remembered,
      ),
    );
    this.intent = null;
    this.judged();
    return true;
  }

  private async loadVersions(): Promise<void> {
    const observing = this.observing;
    if (observing === null) return;
    const ticket = (this.versionsTicket += 1);
    const generation = this.generation;
    if (this._versions().status !== 'ready') this._versions.set(LOADING);
    const read = await this.timed(() =>
      observing.history(ADMIN_RHYTHM_STREAK_ID),
    );
    if (generation !== this.generation || ticket !== this.versionsTicket) {
      return;
    }
    if (read.isSuccess()) {
      this._versions.set({ status: 'ready', data: read.value });
    } else if (this._versions().status !== 'ready') {
      this._versions.set(FAILED);
    }
  }

  // ── The writes ───────────────────────────────────────────────────────────

  private async publishDraft(): Promise<PublishOutcome> {
    const base = this._base();
    const publishing = this.publishing;
    if (base === null || publishing === null) {
      return {
        kind: 'failed',
        error: new RepositoryError('The rhythm rule has not been read'),
      };
    }
    if (this.tick() && this.dirty()) {
      // The rule moved under the draft overnight. Nothing is sent: the
      // form shows the draft over today's rule first, and the next
      // «Запази» publishes what the admin has then seen.
      this._refusal.set(STALE);
      return STALE;
    }
    const { today } = this.days();
    const input = {
      observed: base,
      draft: this._draft(),
      effectiveFrom: this.effectiveFrom(),
      today,
      policy: this.policy,
    };
    const assessed = publishing.assess(input);
    const requestId = (this.intent ??= this.nextId());
    const generation = this.generation;
    this._refusal.set(null);
    this._saving.set(true);
    let outcome: PublishOutcome;
    try {
      outcome = await publishing.execute({
        ...input,
        transition: ADMIN_RHYTHM_TRANSITION,
        requestId,
        previewHash: null,
      });
    } catch (error) {
      outcome = {
        kind: 'failed',
        error: new RepositoryError('The publish threw', error),
      };
    }
    if (generation !== this.generation) return outcome;
    this._saving.set(false);
    // A save that got no answer keeps its id: the retry is the same intent.
    if (outcome.kind !== 'failed') this.intent = null;

    if (outcome.kind === 'published') {
      const live = this._live();
      const told =
        live !== null && live.published && newestOf(live) >= outcome.version;
      const head =
        (told || assessed.kind !== 'valid'
          ? live
          : (headAfterPublish(base, assessed.definition, outcome, today) ??
            live)) ?? base;
      this._live.set(head);
      this.adopt(head);
      // A head that was heard has read the history already.
      if (!told) void this.loadVersions();
      return outcome;
    }

    if (outcome.kind === 'unchanged') {
      this.settleAfterWrite();
      return outcome;
    }
    this._refusal.set(outcome);
    if (outcome.kind === 'tooEarly' && assessed.kind === 'valid') {
      // The day moves to the earliest the server allows (`effectiveFrom`
      // is never under `earliestDay`), and that day stays the floor for
      // a change of this direction. The day the admin chose is kept: a
      // draft that turns the other way goes back to it.
      this._floor.set({
        day: outcome.earliest,
        direction: assessed.change.direction,
      });
    }
    if (outcome.kind === 'refused' && outcome.refusal === 'stale') {
      // The refusal IS the notice: the draft is kept and judged against
      // the rule as it now stands.
      const live = this._live();
      if (live !== null) this.rebase(live);
      return outcome;
    }
    this.settleAfterWrite();
    return outcome;
  }

  private async withdrawWaiting(): Promise<WithdrawOutcome> {
    const head = this._live();
    const publishing = this.publishing;
    if (head === null || publishing === null) {
      return {
        kind: 'failed',
        error: new RepositoryError('The rhythm rule has not been read'),
      };
    }
    this.tick();
    const requestId = (this.withdrawIntent ??= this.nextId());
    const generation = this.generation;
    this._withdrawing.set(true);
    let outcome: WithdrawOutcome;
    try {
      outcome = await publishing.withdraw({
        observed: head,
        requestId,
        today: this.days().today,
      });
    } catch (error) {
      outcome = {
        kind: 'failed',
        error: new RepositoryError('The withdrawal threw', error),
      };
    }
    if (generation !== this.generation) return outcome;
    this._withdrawing.set(false);
    if (outcome.kind !== 'failed') this.withdrawIntent = null;

    if (outcome.kind !== 'withdrawn') {
      this.settleAfterWrite();
      return outcome;
    }
    const live = this._live();
    const told =
      live !== null &&
      live.schedule.scheduled?.definition.version !== outcome.version;
    const next = (told ? live : (headAfterWithdrawal(head) ?? live)) ?? head;
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
    if (
      facts === null ||
      base === null ||
      assessment?.kind !== 'valid' ||
      assessment.change.changed.length === 0
    ) {
      this._preview.set(null);
      this._previewBusy.set(false);
      return;
    }
    const inForce = base.schedule.inForceOn(this.days().today);
    const reads = rhythmPreviewReadsFacts(inForce, assessment.definition);
    if (reads && facts.failed) {
      // The walk failed and nobody asked for it again: the notice stays,
      // with no skeleton in between, until «Опитай пак».
      this._preview.set(FAILED);
      this._previewBusy.set(false);
      return;
    }
    if (this._preview()?.status !== 'ready') this._preview.set(LOADING);
    this._previewBusy.set(true);
    if (reads) void facts.read();
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
    if (assessment?.kind !== 'valid') return;
    const { today } = this.days();
    const inForce = base.schedule.inForceOn(today);
    const draft = assessment.definition;

    if (!rhythmPreviewReadsFacts(inForce, draft)) {
      this._preview.set({
        status: 'ready',
        data: rhythmPreviewOf({
          inForce,
          draft,
          facts: { clients: [], capped: false },
          today,
        }),
      });
      this._previewCapped.set(false);
      this._previewBusy.set(false);
      return;
    }
    const read = await this.timed(() => facts.read());
    if (stale()) return;
    if (read.isFailure()) {
      // The answer on screen is about another draft: it goes.
      this._preview.set(FAILED);
      this._previewBusy.set(false);
      return;
    }
    this._preview.set({
      status: 'ready',
      data: rhythmPreviewOf({ inForce, draft, facts: read.value, today }),
    });
    this._previewCapped.set(read.value.capped);
    this._previewBusy.set(false);
  }

  // ── Support ──────────────────────────────────────────────────────────────

  private wordsOf(definition: StreakDefinition): RhythmRuleWords | null {
    const lang = this.loadedLang();
    if (lang === null) return null;
    const names = this._names();
    return rhythmRuleWords(
      definition.summary(),
      (key, params) => this.transloco.translate(key, params, lang),
      lang,
      { nameOf: (id) => names.get(id) ?? null },
    );
  }

  private readNow(): ZonedDateTime {
    const told = this.clock?.now(SHOP_ZONE);
    if (told?.isSuccess()) return told.value;
    const now = ZonedDateTime.now(SHOP_ZONE);
    // Unreachable: the zone is a constant IANA name.
    if (now.isFailure()) throw now.error;
    return now.value;
  }

  private nextId(): string {
    return this.ids?.next() ?? crypto.randomUUID();
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

  /** The read, or a failure after `ADMIN_RHYTHM_READ_TIMEOUT_MS`; a thrown error is a failure too. */
  private timed<T>(
    read: () => Promise<Result<T, RepositoryError>>,
  ): Promise<Result<T, RepositoryError>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve(
          fail(
            new RepositoryError(
              `The read did not answer within ${ADMIN_RHYTHM_READ_TIMEOUT_MS} ms`,
            ),
          ),
        );
      }, ADMIN_RHYTHM_READ_TIMEOUT_MS);
      this.timers.add(timer);
      const settle = (result: Result<T, RepositoryError>) => {
        clearTimeout(timer);
        this.timers.delete(timer);
        resolve(result);
      };
      let pending: Promise<Result<T, RepositoryError>>;
      try {
        pending = read();
      } catch (error) {
        settle(fail(new RepositoryError('The read threw', error)));
        return;
      }
      pending.then(settle, (error: unknown) =>
        settle(fail(new RepositoryError('The read threw', error))),
      );
    });
  }
}
