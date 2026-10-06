import { Result, fail, ok } from '@creativo/domain/kernel';
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
type PartDirection = Exclude<StreakRuleDirection, 'switch'>;

const wholeWithin = (value: unknown, range: Whole): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= range.min &&
  value <= range.max;

/** Which way a figure moved, given which way is the client's. */
const moved = (
  before: number,
  after: number,
  more: 'looser' | 'stricter',
): PartDirection => {
  if (after === before) return 'neutral';
  const less = more === 'looser' ? 'stricter' : 'looser';
  return after > before ? more : less;
};

const blend = (parts: readonly PartDirection[]): PartDirection => {
  const looser = parts.includes('looser');
  const stricter = parts.includes('stricter');
  if (parts.includes('mixed') || (looser && stricter)) return 'mixed';
  if (looser) return 'looser';
  return stricter ? 'stricter' : 'neutral';
};

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
    if (result.isFailure()) throw new Error('unreachable: defaults are valid');
    StreakDefinition._default = result.value;
    return result.value;
  }

  /** Is this cause one the rule never counts against the client? */
  isExcused(cause: StreakExcuse): boolean {
    return this.excuses.includes(cause);
  }

  summary(): StreakRuleSummary {
    const { protections, bookingHold, repair } = this;
    return {
      enabled: this.enabled,
      interval: this.interval.toProps(),
      graceDays: this.graceDays,
      protections:
        protections.enabled && protections.maxBanked > 0
          ? {
              maxBanked: protections.maxBanked,
              earnEvery: protections.earnEvery,
            }
          : null,
      shopExcuses: STREAK_SHOP_EXCUSES.every((excuse) =>
        this.excuses.includes(excuse),
      ),
      hold:
        bookingHold.enabled && bookingHold.maxDaysPastDue > 0
          ? { maxDaysPastDue: bookingHold.maxDaysPastDue }
          : null,
      repair:
        repair.enabled && this.onBreak === 'restart'
          ? { windowDays: repair.windowDays }
          : null,
      holdsCount: this.onBreak === 'hold',
      qualifier: this.qualifier.toProps(),
    };
  }

  /**
   * What moved since `previous`, and whom it favours. A part is judged by
   * what it DOES: a figure of a part that is off, before and after, is
   * listed as changed and moves nothing (`neutral`).
   */
  changeFrom(previous: StreakDefinition): StreakRuleChange {
    const parts: [keyof StreakDefinitionProps, boolean, PartDirection][] = [
      ['name', !this.name.equals(previous.name), 'neutral'],
      ['enabled', this.enabled !== previous.enabled, 'neutral'],
      [
        'qualifier',
        !this.qualifier.equals(previous.qualifier),
        this.qualifierFrom(previous),
      ],
      [
        'minGapDays',
        this.minGapDays !== previous.minGapDays,
        moved(previous.minGapDays, this.minGapDays, 'stricter'),
      ],
      [
        'bookingHold',
        !sameFigures(this.bookingHold, previous.bookingHold),
        moved(heldDays(previous), heldDays(this), 'looser'),
      ],
      [
        'interval',
        !this.interval.equals(previous.interval),
        this.intervalFrom(previous),
      ],
      [
        'graceDays',
        this.graceDays !== previous.graceDays,
        moved(previous.graceDays, this.graceDays, 'looser'),
      ],
      ['riskLeadDays', this.riskLeadDays !== previous.riskLeadDays, 'neutral'],
      [
        'protections',
        !sameFigures(this.protections, previous.protections),
        this.protectionsFrom(previous),
      ],
      [
        'excuses',
        this.excuses.join() !== previous.excuses.join(),
        blend([
          this.excuses.some((e) => !previous.excuses.includes(e))
            ? 'looser'
            : 'neutral',
          previous.excuses.some((e) => !this.excuses.includes(e))
            ? 'stricter'
            : 'neutral',
        ]),
      ],
      [
        'clientPause',
        !sameFigures(this.clientPause, previous.clientPause),
        moved(pauseDays(previous), pauseDays(this), 'looser'),
      ],
      [
        'repair',
        !sameFigures(this.repair, previous.repair),
        this.repairFrom(previous),
      ],
      [
        'onBreak',
        this.onBreak !== previous.onBreak,
        this.onBreak === 'hold' ? 'looser' : 'stricter',
      ],
    ];
    const moving = parts.filter(([, differs]) => differs);
    return {
      direction:
        this.enabled !== previous.enabled
          ? 'switch'
          : blend(moving.map(([, , direction]) => direction)),
      changed: moving.map(([key]) => key),
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
      this.version === other.version &&
      this.effectiveFrom === other.effectiveFrom &&
      this.changeFrom(other).changed.length === 0
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

  private qualifierFrom(previous: StreakDefinition): PartDirection {
    switch (this.qualifier.comparedTo(previous.qualifier)) {
      case 'same':
        return 'neutral';
      case 'wider':
        return 'looser';
      case 'narrower':
        return 'stricter';
      case 'other':
        return 'mixed';
    }
  }

  /**
   * Two intervals of one kind are compared figure by figure: every figure
   * of an interval lengthens a period as it grows. Across kinds they are
   * compared by the periods they can open: a personal interval whose
   * shortest period is the fixed one's length favours everyone.
   */
  private intervalFrom(previous: StreakDefinition): PartDirection {
    const after = this.interval.toProps();
    const before = previous.interval.toProps();
    if (after.kind === 'fixed' && before.kind === 'fixed') {
      return moved(before.days, after.days, 'looser');
    }
    if (after.kind === 'personal' && before.kind === 'personal') {
      return blend([
        moved(before.tolerancePct, after.tolerancePct, 'looser'),
        moved(before.minDays, after.minDays, 'looser'),
        moved(before.maxDays, after.maxDays, 'looser'),
        moved(before.fallbackDays, after.fallbackDays, 'looser'),
      ]);
    }
    const longer = this.interval.shortestDays >= previous.interval.longestDays;
    const shorter = this.interval.longestDays <= previous.interval.shortestDays;
    if (longer && shorter) return 'neutral';
    if (longer) return 'looser';
    return shorter ? 'stricter' : 'mixed';
  }

  private protectionsFrom(previous: StreakDefinition): PartDirection {
    const after = reserveOf(this);
    const before = reserveOf(previous);
    if (after === 0 || before === 0) return moved(before, after, 'looser');
    return blend([
      moved(before, after, 'looser'),
      moved(
        previous.protections.earnEvery,
        this.protections.earnEvery,
        'stricter',
      ),
      moved(
        previous.protections.startWith,
        this.protections.startWith,
        'looser',
      ),
    ]);
  }

  /** The way back matters only where a miss breaks the run: under `hold` nothing is broken, before or after. */
  private repairFrom(previous: StreakDefinition): PartDirection {
    if (this.onBreak === 'hold' || previous.onBreak === 'hold') {
      return 'neutral';
    }
    const after = this.repair;
    const before = previous.repair;
    if (!after.enabled || !before.enabled) {
      return moved(Number(before.enabled), Number(after.enabled), 'looser');
    }
    return blend([
      moved(before.windowDays, after.windowDays, 'looser'),
      moved(before.perYear, after.perYear, 'looser'),
    ]);
  }
}

/** Two parts hold the same figures, the switch among them. */
function sameFigures(
  a: Readonly<Record<string, number | boolean>>,
  b: Readonly<Record<string, number | boolean>>,
): boolean {
  const figures = new Map(Object.entries(b));
  return Object.entries(a).every(([key, value]) => figures.get(key) === value);
}

/** The days past the due date a booking holds: none when the hold is off. */
const heldDays = (rule: StreakDefinition): number =>
  rule.bookingHold.enabled ? rule.bookingHold.maxDaysPastDue : 0;

/** The days a year a client may pause: none when the pause is off. */
const pauseDays = (rule: StreakDefinition): number =>
  rule.clientPause.enabled ? rule.clientPause.maxDaysPerYear : 0;

/** What the reserve can hold: nothing when protections are off. */
const reserveOf = (rule: StreakDefinition): number =>
  rule.protections.enabled ? rule.protections.maxBanked : 0;
