import {
  StreakInterval,
  StreakIntervalKind,
} from '../components/streak-interval.data';
import {
  StreakQualifier,
  StreakQualifierKind,
} from '../components/streak-qualifier.data';
import {
  STREAK_EXCUSES,
  StreakRule,
  type StreakExcuse,
  type StreakOnBreak,
} from '../components/streak-rule.data';

/*
 * THE ADMIN'S DRAFT OF THE RHYTHM'S RULE, CLAMPED (client-card revision 3
 * §2.6.4; `admin-rhythm.store.ts` `patchedRhythmDraft`, `rhythmBoundsOf`,
 * `touchedOf`; `admin-rhythm.words.ts` `weeksOf`/`daysOf`). Every figure
 * the form hands over is made whole and held inside the rule's range
 * (`StreakRule.LIMITS`, the table `StreakRule.parse` refuses by), and what
 * depends on another figure is held to it, so no combination the controls
 * can reach is one the rule refuses. The figure in hand wins; what depends
 * on it follows.
 *
 * A change names only what it moves: every part of `RhythmPatch` is present
 * and `null` where the change leaves it alone (absent is `null`).
 */

/** An inclusive range of a figure. */
export type RhythmRange = { readonly min: number; readonly max: number };

/**
 * The interval, as the form changes it: the kind, and whichever of its
 * figures moved (`null` = as held). Naming a kind the draft does not have
 * SWITCHES to it.
 */
export type RhythmIntervalPatch =
  | {
      readonly kind: typeof StreakIntervalKind.Fixed;
      readonly days: number | null;
    }
  | {
      readonly kind: typeof StreakIntervalKind.Personal;
      readonly tolerancePct: number | null;
      readonly minDays: number | null;
      readonly maxDays: number | null;
      readonly fallbackDays: number | null;
    };

/**
 * A change to the draft: any parameter of the rule, any figure of a part —
 * `null` where the change leaves it as held. A version's identity is not
 * the form's to say and is not here.
 */
export type RhythmPatch = {
  readonly enabled: boolean | null;
  readonly qualifier: StreakQualifier | null;
  readonly minGapDays: number | null;
  readonly bookingHold: {
    readonly enabled: boolean | null;
    readonly maxDaysPastDue: number | null;
  } | null;
  readonly interval: RhythmIntervalPatch | null;
  readonly graceDays: number | null;
  readonly riskLeadDays: number | null;
  readonly protections: {
    readonly enabled: boolean | null;
    readonly maxBanked: number | null;
    readonly earnEvery: number | null;
    readonly startWith: number | null;
  } | null;
  readonly excuses: readonly StreakExcuse[] | null;
  readonly clientPause: {
    readonly enabled: boolean | null;
    readonly maxDaysPerYear: number | null;
  } | null;
  readonly repair: {
    readonly enabled: boolean | null;
    readonly windowDays: number | null;
    readonly perYear: number | null;
  } | null;
  readonly onBreak: StreakOnBreak | null;
};

/** The last interval of each kind the draft held, so switching the kind and back loses nothing typed. */
export type RememberedIntervals = {
  readonly fixed: StreakInterval.Fixed | null;
  readonly personal: StreakInterval.Personal | null;
};

/**
 * The ranges that MOVE with the draft, for the controls that show a
 * maximum: grace, the cue and the minimum gap stay under the shortest
 * interval, nobody starts with more protections than the reserve holds,
 * and the newcomer's interval stays inside the clamp. Every other range is
 * `StreakRule.LIMITS`, which does not move.
 */
export type RhythmBounds = {
  readonly graceDays: RhythmRange;
  readonly riskLeadDays: RhythmRange;
  readonly minGapDays: RhythmRange;
  readonly startWith: RhythmRange;
  /** Under a personal interval: the clamp itself. Under a fixed one: the interval's whole range. */
  readonly fallbackDays: RhythmRange;
};

const NO_CHANGE: RhythmPatch = {
  enabled: null,
  qualifier: null,
  minGapDays: null,
  bookingHold: null,
  interval: null,
  graceDays: null,
  riskLeadDays: null,
  protections: null,
  excuses: null,
  clientPause: null,
  repair: null,
  onBreak: null,
};

const NOTHING_REMEMBERED: RememberedIntervals = { fixed: null, personal: null };

/** The personal interval a rule opens on when the admin first chooses it (§2.6.2 P5b, P5c). */
const RECOMMENDED_PERSONAL = {
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
} as const;

const DAYS_IN_WEEK = 7;

const within = (value: number, range: RhythmRange): number =>
  Math.min(range.max, Math.max(range.min, value));

/** A figure as the rule holds one: whole, inside its range. What is no number leaves the figure as it was. */
function figure(
  typed: number | null,
  held: number,
  range: RhythmRange,
): number {
  return within(
    typed !== null && Number.isFinite(typed) ? Math.round(typed) : held,
    range,
  );
}

/** A range of the rule, held under the shortest interval. */
function under(range: RhythmRange, interval: StreakInterval): RhythmRange {
  return {
    min: range.min,
    max: Math.max(
      range.min,
      Math.min(range.max, StreakInterval.shortestDays(interval) - 1),
    ),
  };
}

function intervalOf(
  held: StreakInterval,
  patch: RhythmIntervalPatch | null,
  remembered: RememberedIntervals,
): StreakInterval {
  if (patch === null) return held;
  const { days, tolerancePct } = StreakInterval.LIMITS;
  if (patch.kind === StreakIntervalKind.Fixed) {
    // Coming from a personal interval, the one number closest to it is the
    // newcomer's: what the rule already gave someone it did not know.
    const from =
      held.kind === StreakIntervalKind.Fixed
        ? held.days
        : (remembered.fixed?.days ?? held.fallbackDays);
    return StreakInterval.fixed(figure(patch.days, from, days));
  }
  const from: StreakInterval.Personal =
    held.kind === StreakIntervalKind.Personal
      ? held
      : (remembered.personal ??
        StreakInterval.personal(
          RECOMMENDED_PERSONAL.tolerancePct,
          RECOMMENDED_PERSONAL.minDays,
          RECOMMENDED_PERSONAL.maxDays,
          held.days,
        ));
  let minDays = figure(patch.minDays, from.minDays, days);
  let maxDays = figure(patch.maxDays, from.maxDays, days);
  // The figure in hand wins and the other end of the clamp follows it: a
  // floor typed above the ceiling lifts the ceiling, a ceiling typed under
  // the floor lowers the floor.
  if (minDays > maxDays) {
    if (patch.maxDays !== null) minDays = maxDays;
    else maxDays = minDays;
  }
  return StreakInterval.personal(
    figure(patch.tolerancePct, from.tolerancePct, tolerancePct),
    minDays,
    maxDays,
    figure(patch.fallbackDays, from.fallbackDays, {
      min: minDays,
      max: maxDays,
    }),
  );
}

/** The cue under its bound: as typed when it fits, else the longest the menu offers that does. */
function riskLeadOf(
  typed: number | null,
  held: number,
  range: RhythmRange,
  choices: readonly number[],
): number {
  const asked =
    typed !== null && Number.isFinite(typed) ? Math.round(typed) : held;
  if (asked <= range.max) return Math.max(range.min, asked);
  let longest: number | null = null;
  for (let i = 0; i < choices.length; i++) {
    const days = choices[i] as number;
    if (days <= range.max && (longest === null || days > longest)) {
      longest = days;
    }
  }
  return longest ?? range.max;
}

/** A copy of the choice: the draft never shares a list with whoever handed it over. */
function qualifierOf(qualifier: StreakQualifier): StreakQualifier {
  switch (qualifier.kind) {
    case StreakQualifierKind.Services:
      return StreakQualifier.services([...qualifier.serviceIds]);
    case StreakQualifierKind.Categories:
      return StreakQualifier.categories([...qualifier.categoryIds]);
    default:
      return StreakQualifier.anyVisit();
  }
}

/** The excuses in the vocabulary's order, each once; what the vocabulary does not know is dropped. */
function excusesOf(excuses: readonly StreakExcuse[]): readonly StreakExcuse[] {
  const out: StreakExcuse[] = [];
  for (let i = 0; i < STREAK_EXCUSES.length; i++) {
    const excuse = STREAK_EXCUSES[i] as StreakExcuse;
    for (let k = 0; k < excuses.length; k++) {
      if (excuses[k] === excuse) {
        out.push(excuse);
        break;
      }
    }
  }
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameQualifier(a: StreakQualifier, b: StreakQualifier): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === StreakQualifierKind.Services) {
    return (
      b.kind === StreakQualifierKind.Services &&
      sameList(a.serviceIds, b.serviceIds)
    );
  }
  if (a.kind === StreakQualifierKind.Categories) {
    return (
      b.kind === StreakQualifierKind.Categories &&
      sameList(a.categoryIds, b.categoryIds)
    );
  }
  return true;
}

export const RhythmDraftSystem = {
  /** A change that moves nothing: spread it and name what moves. */
  NO_CHANGE,

  /** Nothing remembered of the other kind of interval. */
  NOTHING_REMEMBERED,

  /** The personal interval a rule opens on when the admin first chooses it, around the interval it had. */
  RECOMMENDED_PERSONAL,

  /**
   * The draft with a change over it, CLAMPED: every figure whole and inside
   * the rule's range, and what depends on another figure held to it. A
   * shorter interval pulls grace, the cue and the minimum gap under it (the
   * cue to the longest of `riskLeadChoices` that fits — a menu, never «13
   * дни»); a smaller reserve pulls what a run starts with; the clamp's two
   * ends push each other and the newcomer's interval stays between them;
   * the excuses keep the vocabulary's order, each once; a list of what
   * counts is copied, never shared. A version's identity is kept.
   *
   * What it cannot mend is a LIST: «Посещение с избрани услуги» with no
   * service chosen yet is no rule (`StreakRule.parse` says so).
   */
  clamp(
    draft: StreakRule,
    patch: RhythmPatch,
    remembered: RememberedIntervals,
    riskLeadChoices: readonly number[],
  ): StreakRule {
    const limits = StreakRule.LIMITS;
    const interval = intervalOf(draft.interval, patch.interval, remembered);
    const maxBanked = figure(
      patch.protections?.maxBanked ?? null,
      draft.protections.maxBanked,
      limits.protections.maxBanked,
    );
    return {
      version: draft.version,
      effectiveFromDayKey: draft.effectiveFromDayKey,
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
          patch.bookingHold?.maxDaysPastDue ?? null,
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
        riskLeadChoices,
      ),
      protections: {
        enabled: patch.protections?.enabled ?? draft.protections.enabled,
        maxBanked,
        earnEvery: figure(
          patch.protections?.earnEvery ?? null,
          draft.protections.earnEvery,
          limits.protections.earnEvery,
        ),
        startWith: figure(
          patch.protections?.startWith ?? null,
          draft.protections.startWith,
          {
            min: limits.protections.startWith.min,
            max: Math.min(limits.protections.startWith.max, maxBanked),
          },
        ),
      },
      excuses: excusesOf(patch.excuses ?? draft.excuses),
      clientPause: {
        enabled: patch.clientPause?.enabled ?? draft.clientPause.enabled,
        maxDaysPerYear: figure(
          patch.clientPause?.maxDaysPerYear ?? null,
          draft.clientPause.maxDaysPerYear,
          limits.clientPause.maxDaysPerYear,
        ),
      },
      repair: {
        enabled: patch.repair?.enabled ?? draft.repair.enabled,
        windowDays: figure(
          patch.repair?.windowDays ?? null,
          draft.repair.windowDays,
          limits.repair.windowDays,
        ),
        perYear: figure(
          patch.repair?.perYear ?? null,
          draft.repair.perYear,
          limits.repair.perYear,
        ),
      },
      onBreak: patch.onBreak ?? draft.onBreak,
    };
  },

  /** The ranges that move with the draft. */
  bounds(draft: StreakRule): RhythmBounds {
    const limits = StreakRule.LIMITS;
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
        interval.kind === StreakIntervalKind.Personal
          ? { min: interval.minDays, max: interval.maxDays }
          : limits.interval.days,
    };
  },

  /**
   * The parameters of a draft that differ from the rule it was made on, as
   * the change that made them — what the admin did, apart from what the
   * rule already said. A part that differs is named whole; the rest `null`.
   */
  diff(draft: StreakRule, madeOn: StreakRule): RhythmPatch {
    const hold = draft.bookingHold;
    const protections = draft.protections;
    const pause = draft.clientPause;
    const repair = draft.repair;
    return {
      enabled: draft.enabled === madeOn.enabled ? null : draft.enabled,
      qualifier: sameQualifier(draft.qualifier, madeOn.qualifier)
        ? null
        : draft.qualifier,
      minGapDays:
        draft.minGapDays === madeOn.minGapDays ? null : draft.minGapDays,
      bookingHold:
        hold.enabled === madeOn.bookingHold.enabled &&
        hold.maxDaysPastDue === madeOn.bookingHold.maxDaysPastDue
          ? null
          : hold,
      interval: StreakInterval.equals(draft.interval, madeOn.interval)
        ? null
        : draft.interval.kind === StreakIntervalKind.Fixed
          ? { kind: StreakIntervalKind.Fixed, days: draft.interval.days }
          : {
              kind: StreakIntervalKind.Personal,
              tolerancePct: draft.interval.tolerancePct,
              minDays: draft.interval.minDays,
              maxDays: draft.interval.maxDays,
              fallbackDays: draft.interval.fallbackDays,
            },
      graceDays: draft.graceDays === madeOn.graceDays ? null : draft.graceDays,
      riskLeadDays:
        draft.riskLeadDays === madeOn.riskLeadDays ? null : draft.riskLeadDays,
      protections:
        protections.enabled === madeOn.protections.enabled &&
        protections.maxBanked === madeOn.protections.maxBanked &&
        protections.earnEvery === madeOn.protections.earnEvery &&
        protections.startWith === madeOn.protections.startWith
          ? null
          : protections,
      excuses: sameList(draft.excuses, madeOn.excuses) ? null : draft.excuses,
      clientPause:
        pause.enabled === madeOn.clientPause.enabled &&
        pause.maxDaysPerYear === madeOn.clientPause.maxDaysPerYear
          ? null
          : pause,
      repair:
        repair.enabled === madeOn.repair.enabled &&
        repair.windowDays === madeOn.repair.windowDays &&
        repair.perYear === madeOn.repair.perYear
          ? null
          : repair,
      onBreak: draft.onBreak === madeOn.onBreak ? null : draft.onBreak,
    };
  },

  /** Days as the nearest whole number of weeks — what the editor shows an interval in. */
  weeksOf(days: number): number {
    return Math.round(days / DAYS_IN_WEEK);
  },

  /** Weeks as days — what the rule holds an interval in. */
  daysOf(weeks: number): number {
    return weeks * DAYS_IN_WEEK;
  },
} as const;
