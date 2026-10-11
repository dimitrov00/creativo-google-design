import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  LocalDate,
  ServiceCategoryId,
  ServiceId,
  defect,
} from '@core/primitives';
import {
  StreakExcuse as SystemExcuse,
  StreakInterval as SystemInterval,
  StreakIntervalRule,
  StreakOnBreak as SystemOnBreak,
  StreakQualifier as SystemQualifier,
  StreakQualifierRule,
  type StreakRule,
  StreakRuleDirection as SystemDirection,
  StreakRuleParameter,
} from '@core/components';
import { StreakRuleSystem } from '@core/systems';
import { LocalizedText, LocalizedTextProps } from '@creativo/domain/catalog';
import { IsoDate, isIsoDate } from './loyalty-calendar';
import {
  StreakBookingHoldOutOfRangeError,
  StreakClientPauseOutOfRangeError,
  StreakDefinitionError,
  StreakEffectiveDayInvalidError,
  StreakGraceNotShorterThanIntervalError,
  StreakGraceOutOfRangeError,
  StreakIdEmptyError,
  StreakMinGapOutOfRangeError,
  StreakNameEmptyError,
  StreakProtectionsOutOfRangeError,
  StreakRepairOutOfRangeError,
  StreakRiskLeadOutOfRangeError,
  StreakStartWithAboveCapError,
  StreakUnknownExcuseError,
  StreakUnknownOptionError,
  StreakVersionNotPositiveError,
} from './streak-definition.errors';
import {
  STREAK_INTERVAL_LIMITS,
  StreakInterval,
  StreakIntervalProps,
} from './streak-interval';
import { StreakQualifier, StreakQualifierProps } from './streak-qualifier';

/**
 * What never counts against the client's rhythm. The first three are the
 * shop calling a visit off; `closedDays` is the due date falling on days
 * the shop was closed, with no booking involved.
 */
export const STREAK_EXCUSES = [
  'shopClosure',
  'barberAbsence',
  'staffCancelled',
  'closedDays',
] as const;
export type StreakExcuse = (typeof STREAK_EXCUSES)[number];

/** The excuses that are a visit the SHOP called off: the rule's sentence promises them together. */
export const STREAK_SHOP_EXCUSES = [
  'shopClosure',
  'barberAbsence',
  'staffCancelled',
] as const satisfies readonly StreakExcuse[];

/** What a miss does: the count starts over (the best stays), or it holds and goes on at the next visit. */
export const STREAK_ON_BREAK = ['restart', 'hold'] as const;
export type StreakOnBreak = (typeof STREAK_ON_BREAK)[number];

/**
 * Every range of the rule, inclusive, in ONE table: what `create` refuses
 * by and what an editor clamps to, so the two cannot drift. Three figures
 * have a second bound that moves with the rule: grace, the cue and the
 * minimum gap stay under the shortest interval, and nobody starts with
 * more protections than the reserve holds.
 */
export const STREAK_LIMITS = {
  interval: STREAK_INTERVAL_LIMITS,
  minGapDays: { min: 0, max: 14 },
  bookingHold: { maxDaysPastDue: { min: 0, max: 28 } },
  graceDays: { min: 0, max: 21 },
  riskLeadDays: { min: 0, max: 21 },
  protections: {
    maxBanked: { min: 0, max: 5 },
    earnEvery: { min: 1, max: 24 },
    startWith: { min: 0, max: 5 },
  },
  clientPause: { maxDaysPerYear: { min: 0, max: 180 } },
  repair: {
    windowDays: { min: 1, max: 60 },
    perYear: { min: 1, max: 4 },
  },
} as const;

/**
 * `streakDefinitions/{id}`, one version of it: «Посещения в ритъм» as the
 * admin edits it (client-card revision 3 §4.1, P1–P12). The UI word for a
 * protection is «защита». A protection is automatic and free, a no-show
 * never breaks the rhythm by itself and the best run never decreases:
 * those are fixed by ethics and are not parameters.
 */
export interface StreakDefinitionProps {
  id: string;
  name: LocalizedTextProps;
  /** Rises by one with every publish. */
  version: number;
  /** The first Europe/Sofia day this version judges by. */
  effectiveFrom: IsoDate;
  /** P1. Off: the rhythm is shown nowhere and nothing moves; runs are held, never erased. */
  enabled: boolean;
  /** P2. Which visit keeps the rhythm. */
  qualifier: StreakQualifierProps;
  /** P3. A visit closer than this to the last counted one moves the due date and adds nothing to the count. */
  minGapDays: number;
  /** P4. A visit on the book, starting no later than this past the due date, keeps the period open. */
  bookingHold: { enabled: boolean; maxDaysPastDue: number };
  /** P5. */
  interval: StreakIntervalProps;
  /** P6. Days after the due date in which a visit still keeps the run. */
  graceDays: number;
  /** P7. How early the staff's card turns to its cue. Coaching only: it changes nothing for the client. */
  riskLeadDays: number;
  /** P8. A protection covers one missed due date and moves it one interval on. */
  protections: {
    enabled: boolean;
    maxBanked: number;
    earnEvery: number;
    startWith: number;
  };
  /** P9. */
  excuses: readonly StreakExcuse[];
  /** P10. */
  clientPause: { enabled: boolean; maxDaysPerYear: number };
  /** P11. The first counted visit within the window of a break restores the run. */
  repair: { enabled: boolean; windowDays: number; perYear: number };
  /** P12. */
  onBreak: StreakOnBreak;
}

/**
 * The rule as the card and the editor word it: structure, never copy (the
 * domain owns no strings). A part is `null` when the rule has nothing to
 * say about it, so a sentence is printed only for what holds.
 */
export interface StreakRuleSummary {
  readonly enabled: boolean;
  readonly interval: StreakIntervalProps;
  readonly graceDays: number;
  /** `null`: protections are off, or the reserve holds none. */
  readonly protections: {
    readonly maxBanked: number;
    readonly earnEvery: number;
  } | null;
  /** Every visit the shop calls off is excused: all of {@link STREAK_SHOP_EXCUSES}. */
  readonly shopExcuses: boolean;
  /** `null`: off, or no day past the due date is held. */
  readonly hold: { readonly maxDaysPastDue: number } | null;
  /** `null`: off, or a miss holds the count and there is nothing to restore. */
  readonly repair: { readonly windowDays: number } | null;
  /** A miss does not reset the count. */
  readonly holdsCount: boolean;
  readonly qualifier: StreakQualifierProps;
}

/**
 * A change, by whom it favours. `looser` and `stricter` are the client's
 * view; `mixed` is both at once; `neutral` moves nothing for the client
 * (the staff's cue, the name, a figure of a part that is off); `switch` is
 * the rule going on or off, whatever else moved with it.
 */
export type StreakRuleDirection =
  'looser' | 'stricter' | 'mixed' | 'neutral' | 'switch';

export interface StreakRuleChange {
  readonly direction: StreakRuleDirection;
  /**
   * The parameters that differ, in the rule's own order. A version's
   * identity (`id`, `version`, `effectiveFrom`) is never listed: it is
   * what every revision changes.
   */
  readonly changed: readonly (keyof StreakDefinitionProps)[];
}

type Whole = { readonly min: number; readonly max: number };

const wholeWithin = (value: unknown, range: Whole): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= range.min &&
  value <= range.max;

/**
 * One version of the rhythm's rule, validated: every figure inside its
 * range, grace and the cue shorter than the shortest interval, a reserve
 * that can hold what a run starts with. A rule that reads as nonsense is
 * refused here, with every fault at once, before it reaches a document or
 * a client.
 */
export class StreakDefinition {
  private constructor(
    readonly id: string,
    readonly name: LocalizedText,
    readonly version: number,
    readonly effectiveFrom: IsoDate,
    readonly enabled: boolean,
    readonly qualifier: StreakQualifier,
    readonly minGapDays: number,
    readonly bookingHold: {
      readonly enabled: boolean;
      readonly maxDaysPastDue: number;
    },
    readonly interval: StreakInterval,
    readonly graceDays: number,
    readonly riskLeadDays: number,
    readonly protections: {
      readonly enabled: boolean;
      readonly maxBanked: number;
      readonly earnEvery: number;
      readonly startWith: number;
    },
    /** In the vocabulary's order, each once. */
    readonly excuses: readonly StreakExcuse[],
    readonly clientPause: {
      readonly enabled: boolean;
      readonly maxDaysPerYear: number;
    },
    readonly repair: {
      readonly enabled: boolean;
      readonly windowDays: number;
      readonly perYear: number;
    },
    readonly onBreak: StreakOnBreak,
  ) {}

  static create(
    props: StreakDefinitionProps,
  ): Result<StreakDefinition, StreakDefinitionError[]> {
    const limits = STREAK_LIMITS;
    const errors: StreakDefinitionError[] = [];

    if (typeof props.id !== 'string' || props.id.trim().length === 0) {
      errors.push(new StreakIdEmptyError(props.id));
    }
    const name = LocalizedText.create(props.name);
    if (name.isFailure()) {
      errors.push(
        ...name.error.map(
          ({ locale }) =>
            new StreakNameEmptyError(
              locale,
              locale === 'bg' ? props.name.bg : props.name.en,
            ),
        ),
      );
    }
    if (!Number.isInteger(props.version) || props.version < 1) {
      errors.push(new StreakVersionNotPositiveError(props.version));
    }
    if (!isIsoDate(props.effectiveFrom)) {
      errors.push(new StreakEffectiveDayInvalidError(props.effectiveFrom));
    }

    const qualifier = StreakQualifier.create(props.qualifier);
    if (qualifier.isFailure()) errors.push(...qualifier.error);
    const interval = StreakInterval.create(props.interval);
    if (interval.isFailure()) errors.push(...interval.error);

    // What stays under the interval is judged against a SOUND interval
    // only: with a broken one, the figure's own range is all that is known.
    const under = (range: Whole): Whole =>
      interval.isFailure()
        ? range
        : {
            min: range.min,
            max: Math.min(range.max, interval.value.shortestDays - 1),
          };

    const minGap = under(limits.minGapDays);
    if (!wholeWithin(props.minGapDays, minGap)) {
      errors.push(
        new StreakMinGapOutOfRangeError(
          props.minGapDays,
          minGap.min,
          minGap.max,
        ),
      );
    }
    const hold = limits.bookingHold.maxDaysPastDue;
    if (!wholeWithin(props.bookingHold.maxDaysPastDue, hold)) {
      errors.push(
        new StreakBookingHoldOutOfRangeError(
          props.bookingHold.maxDaysPastDue,
          hold.min,
          hold.max,
        ),
      );
    }
    if (!wholeWithin(props.graceDays, limits.graceDays)) {
      errors.push(
        new StreakGraceOutOfRangeError(
          props.graceDays,
          limits.graceDays.min,
          limits.graceDays.max,
        ),
      );
    } else if (
      interval.isSuccess() &&
      props.graceDays >= interval.value.shortestDays
    ) {
      errors.push(
        new StreakGraceNotShorterThanIntervalError(
          props.graceDays,
          interval.value.shortestDays,
        ),
      );
    }
    const riskLead = under(limits.riskLeadDays);
    if (!wholeWithin(props.riskLeadDays, riskLead)) {
      errors.push(
        new StreakRiskLeadOutOfRangeError(
          props.riskLeadDays,
          riskLead.min,
          riskLead.max,
        ),
      );
    }

    const { maxBanked, earnEvery, startWith } = props.protections;
    const reserveHolds = wholeWithin(maxBanked, limits.protections.maxBanked);
    if (!reserveHolds) {
      errors.push(
        new StreakProtectionsOutOfRangeError(
          'protections.maxBanked',
          maxBanked,
          limits.protections.maxBanked.min,
          limits.protections.maxBanked.max,
        ),
      );
    }
    if (!wholeWithin(earnEvery, limits.protections.earnEvery)) {
      errors.push(
        new StreakProtectionsOutOfRangeError(
          'protections.earnEvery',
          earnEvery,
          limits.protections.earnEvery.min,
          limits.protections.earnEvery.max,
        ),
      );
    }
    if (!wholeWithin(startWith, limits.protections.startWith)) {
      errors.push(
        new StreakProtectionsOutOfRangeError(
          'protections.startWith',
          startWith,
          limits.protections.startWith.min,
          limits.protections.startWith.max,
        ),
      );
    } else if (reserveHolds && startWith > maxBanked) {
      errors.push(new StreakStartWithAboveCapError(startWith, maxBanked));
    }

    const known: readonly string[] = STREAK_EXCUSES;
    for (const excuse of props.excuses) {
      if (!known.includes(excuse)) {
        errors.push(new StreakUnknownExcuseError(excuse));
      }
    }

    const pause = limits.clientPause.maxDaysPerYear;
    if (!wholeWithin(props.clientPause.maxDaysPerYear, pause)) {
      errors.push(
        new StreakClientPauseOutOfRangeError(
          props.clientPause.maxDaysPerYear,
          pause.min,
          pause.max,
        ),
      );
    }
    if (!wholeWithin(props.repair.windowDays, limits.repair.windowDays)) {
      errors.push(
        new StreakRepairOutOfRangeError(
          'repair.windowDays',
          props.repair.windowDays,
          limits.repair.windowDays.min,
          limits.repair.windowDays.max,
        ),
      );
    }
    if (!wholeWithin(props.repair.perYear, limits.repair.perYear)) {
      errors.push(
        new StreakRepairOutOfRangeError(
          'repair.perYear',
          props.repair.perYear,
          limits.repair.perYear.min,
          limits.repair.perYear.max,
        ),
      );
    }
    if (!(STREAK_ON_BREAK as readonly string[]).includes(props.onBreak)) {
      errors.push(
        new StreakUnknownOptionError('onBreak', props.onBreak, STREAK_ON_BREAK),
      );
    }

    if (
      errors.length > 0 ||
      name.isFailure() ||
      qualifier.isFailure() ||
      interval.isFailure()
    ) {
      return fail(errors);
    }
    return ok(
      new StreakDefinition(
        props.id,
        name.value,
        props.version,
        props.effectiveFrom,
        props.enabled,
        qualifier.value,
        props.minGapDays,
        Object.freeze({
          enabled: props.bookingHold.enabled,
          maxDaysPastDue: props.bookingHold.maxDaysPastDue,
        }),
        interval.value,
        props.graceDays,
        props.riskLeadDays,
        Object.freeze({
          enabled: props.protections.enabled,
          maxBanked,
          earnEvery,
          startWith,
        }),
        Object.freeze(
          STREAK_EXCUSES.filter((excuse) => props.excuses.includes(excuse)),
        ),
        Object.freeze({
          enabled: props.clientPause.enabled,
          maxDaysPerYear: props.clientPause.maxDaysPerYear,
        }),
        Object.freeze({
          enabled: props.repair.enabled,
          windowDays: props.repair.windowDays,
          perYear: props.repair.perYear,
        }),
        props.onBreak,
      ),
    );
  }

  private static _default: StreakDefinition | null = null;

  /**
   * The recommended rule, and what an editor opens on when the shop has
   * published none: a visit every six weeks, a week of grace, a week's cue,
   * two protections earned one per five visits, every visit the shop calls
   * off excused, one way back a year within two weeks of a break, and a
   * miss that starts the count over.
   *
   * MEMOISED, the `BookingPolicy.default()` precedent: one set of values
   * is one value, and a reader keyed on identity is not re-run by asking.
   */
  static default(): StreakDefinition {
    if (StreakDefinition._default) return StreakDefinition._default;
    const result = StreakDefinition.create({
      id: 'cadence',
      name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
      version: 1,
      effectiveFrom: '2025-03-01',
      enabled: true,
      qualifier: { kind: 'anyVisit' },
      minGapDays: 7,
      bookingHold: { enabled: true, maxDaysPastDue: 14 },
      interval: { kind: 'fixed', days: 42 },
      graceDays: 7,
      riskLeadDays: 7,
      protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
      excuses: STREAK_SHOP_EXCUSES,
      clientPause: { enabled: false, maxDaysPerYear: 90 },
      repair: { enabled: true, windowDays: 14, perYear: 1 },
      onBreak: 'restart',
    });
    if (result.isFailure()) defect('unreachable: defaults are valid');
    StreakDefinition._default = result.value;
    return result.value;
  }

  /** Is this cause one the rule never counts against the client? */
  isExcused(cause: StreakExcuse): boolean {
    return this.excuses.includes(cause);
  }

  summary(): StreakRuleSummary {
    const summary = StreakRuleSystem.summary(ruleOf(this));
    const { interval, qualifier } = summary;
    return {
      ...summary,
      interval:
        interval.streakInterval === SystemInterval.Fixed
          ? { kind: 'fixed', days: interval.intervalDays }
          : {
              kind: 'personal',
              tolerancePct: interval.intervalTolerancePct,
              minDays: interval.intervalMinDays,
              maxDays: interval.intervalMaxDays,
              fallbackDays: interval.intervalFallbackDays,
            },
      qualifier:
        qualifier.streakQualifier === SystemQualifier.Services
          ? { kind: 'services', serviceIds: qualifier.qualifierServiceIds }
          : qualifier.streakQualifier === SystemQualifier.Categories
            ? {
                kind: 'categories',
                categoryIds: qualifier.qualifierCategoryIds,
              }
            : { kind: 'anyVisit' },
    };
  }

  /**
   * What moved since `previous`, and whom it favours. A part is judged by
   * what it DOES: a figure of a part that is off, before and after, is
   * listed as changed and moves nothing (`neutral`). The math is
   * `StreakRuleSystem.changeFrom`; the name is the head's, compared here.
   */
  changeFrom(previous: StreakDefinition): StreakRuleChange {
    const change = StreakRuleSystem.changeFrom(
      ruleOf(this),
      ruleOf(previous),
      !this.name.equals(previous.name),
    );
    return {
      direction: LEGACY_DIRECTION[change.direction],
      changed: change.changed.map((parameter) => LEGACY_PARAMETER[parameter]),
    };
  }

  /**
   * The next version: this rule with `patch` over it, numbered one above
   * and taking effect on `effectiveFrom`. A part in the patch replaces the
   * whole part. The id never changes, and the patch cannot number itself.
   */
  revise(
    patch: Partial<StreakDefinitionProps>,
    effectiveFrom: IsoDate,
  ): Result<StreakDefinition, StreakDefinitionError[]> {
    return StreakDefinition.create({
      ...this.toProps(),
      ...patch,
      id: this.id,
      version: this.version + 1,
      effectiveFrom,
    });
  }

  /** The same version of the same rule, figure by figure. */
  equals(other: StreakDefinition): boolean {
    return (
      this.id === other.id &&
      this.name.equals(other.name) &&
      StreakRuleSystem.equals(ruleOf(this), ruleOf(other))
    );
  }

  /** A fresh, plain copy: what the document holds and what an editor drafts on. */
  toProps(): StreakDefinitionProps {
    return {
      id: this.id,
      name: { bg: this.name.bg, en: this.name.en },
      version: this.version,
      effectiveFrom: this.effectiveFrom,
      enabled: this.enabled,
      qualifier: this.qualifier.toProps(),
      minGapDays: this.minGapDays,
      bookingHold: { ...this.bookingHold },
      interval: this.interval.toProps(),
      graceDays: this.graceDays,
      riskLeadDays: this.riskLeadDays,
      protections: { ...this.protections },
      excuses: [...this.excuses],
      clientPause: { ...this.clientPause },
      repair: { ...this.repair },
      onBreak: this.onBreak,
    };
  }
}

// ── The bridge: legacy class ↔ ecs-core struct (Phase 4 deletes it) ──────

/** The excuses, in the system's words. */
const SYSTEM_EXCUSE = {
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<StreakExcuse, SystemExcuse>;

/** What a miss does, in the system's words. */
const SYSTEM_ON_BREAK = {
  restart: SystemOnBreak.Restart,
  hold: SystemOnBreak.Hold,
} as const satisfies Record<StreakOnBreak, SystemOnBreak>;

/** A change's direction, in the legacy words. */
const LEGACY_DIRECTION: Readonly<Record<SystemDirection, StreakRuleDirection>> =
  {
    [SystemDirection.Looser]: 'looser',
    [SystemDirection.Stricter]: 'stricter',
    [SystemDirection.Mixed]: 'mixed',
    [SystemDirection.Neutral]: 'neutral',
    [SystemDirection.Switch]: 'switch',
  };

/** A parameter that moved, as the legacy props name it. */
const LEGACY_PARAMETER: Readonly<
  Record<StreakRuleParameter, keyof StreakDefinitionProps>
> = {
  [StreakRuleParameter.Name]: 'name',
  [StreakRuleParameter.Enabled]: 'enabled',
  [StreakRuleParameter.Qualifier]: 'qualifier',
  [StreakRuleParameter.MinGapDays]: 'minGapDays',
  [StreakRuleParameter.BookingHold]: 'bookingHold',
  [StreakRuleParameter.Interval]: 'interval',
  [StreakRuleParameter.GraceDays]: 'graceDays',
  [StreakRuleParameter.RiskLeadDays]: 'riskLeadDays',
  [StreakRuleParameter.Protections]: 'protections',
  [StreakRuleParameter.Excuses]: 'excuses',
  [StreakRuleParameter.ClientPause]: 'clientPause',
  [StreakRuleParameter.Repair]: 'repair',
  [StreakRuleParameter.OnBreak]: 'onBreak',
};

/**
 * The version as `StreakRuleSystem` reads it: the class's figures, flat
 * (every part's figures prefixed by the part), its day a `LocalDate`,
 * every tag the dictionary's.
 */
function ruleOf(definition: StreakDefinition): StreakRule {
  const props = definition.toProps();
  const day = LocalDate.parse(props.effectiveFrom);
  return {
    version: props.version,
    // A version's day was checked by `create`.
    effectiveFromLocalDate: day.ok
      ? day.value
      : defect(`${props.effectiveFrom} is no calendar day`),
    enabled: props.enabled,
    ...qualifierOf(props.qualifier),
    minGapDays: props.minGapDays,
    bookingHoldEnabled: props.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: props.bookingHold.maxDaysPastDue,
    ...intervalOf(props.interval),
    graceDays: props.graceDays,
    riskLeadDays: props.riskLeadDays,
    protectionsEnabled: props.protections.enabled,
    protectionsMaxBanked: props.protections.maxBanked,
    protectionsEarnEvery: props.protections.earnEvery,
    protectionsStartWith: props.protections.startWith,
    excuses: props.excuses.map((excuse) => SYSTEM_EXCUSE[excuse]),
    clientPauseEnabled: props.clientPause.enabled,
    clientPauseMaxDaysPerYear: props.clientPause.maxDaysPerYear,
    repairEnabled: props.repair.enabled,
    repairWindowDays: props.repair.windowDays,
    repairPerYear: props.repair.perYear,
    onBreak: SYSTEM_ON_BREAK[props.onBreak],
  };
}

function qualifierOf(qualifier: StreakQualifierProps): StreakQualifierRule {
  switch (qualifier.kind) {
    case 'services':
      return StreakQualifierRule.services(
        qualifier.serviceIds.map((id) => ServiceId.of(id)),
      );
    case 'categories':
      return StreakQualifierRule.categories(
        qualifier.categoryIds.map((id) => ServiceCategoryId.of(id)),
      );
    default:
      return StreakQualifierRule.anyVisit();
  }
}

function intervalOf(interval: StreakIntervalProps): StreakIntervalRule {
  return interval.kind === 'fixed'
    ? StreakIntervalRule.fixed(interval.days)
    : StreakIntervalRule.personal(
        interval.tolerancePct,
        interval.minDays,
        interval.maxDays,
        interval.fallbackDays,
      );
}
