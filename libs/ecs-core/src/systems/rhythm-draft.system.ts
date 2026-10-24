import {
  RhythmEffectiveChoice,
  StreakInterval,
  StreakIntervalRule,
  StreakQualifier,
  StreakQualifierRule,
  STREAK_EXCUSES,
  StreakRule,
  type StreakExcuse,
  type StreakOnBreak,
  type StreakRuleInput,
} from '@core/components';
import { LocalDate } from '@core/primitives';

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
 * A change names only what it moves: it mirrors the FLAT rule field by
 * field (Law 6), every field present and `null` where the change leaves it
 * alone (absent is `null`); the qualifier and the interval are named whole,
 * as the slices they are.
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
      readonly streakInterval: typeof StreakInterval.Fixed;
      readonly intervalDays: number | null;
    }
  | {
      readonly streakInterval: typeof StreakInterval.Personal;
      readonly intervalTolerancePct: number | null;
      readonly intervalMinDays: number | null;
      readonly intervalMaxDays: number | null;
      readonly intervalFallbackDays: number | null;
    };

/**
 * A change to the draft: any parameter of the rule, any figure of a part —
 * `null` where the change leaves it as held. A version's identity is not
 * the form's to say and is not here.
 */
export type RhythmPatch = {
  readonly enabled: boolean | null;
  readonly qualifier: StreakQualifierRule | null;
  readonly minGapDays: number | null;
  readonly bookingHoldEnabled: boolean | null;
  readonly bookingHoldMaxDaysPastDue: number | null;
  readonly interval: RhythmIntervalPatch | null;
  readonly graceDays: number | null;
  readonly riskLeadDays: number | null;
  readonly protectionsEnabled: boolean | null;
  readonly protectionsMaxBanked: number | null;
  readonly protectionsEarnEvery: number | null;
  readonly protectionsStartWith: number | null;
  readonly excuses: readonly StreakExcuse[] | null;
  readonly clientPauseEnabled: boolean | null;
  readonly clientPauseMaxDaysPerYear: number | null;
  readonly repairEnabled: boolean | null;
  readonly repairWindowDays: number | null;
  readonly repairPerYear: number | null;
  readonly onBreak: StreakOnBreak | null;
};

/** The last interval of each kind the draft held, so switching the kind and back loses nothing typed. */
export type RememberedIntervals = {
  readonly fixed: StreakIntervalRule.Fixed | null;
  readonly personal: StreakIntervalRule.Personal | null;
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

/**
 * The three days «Влизане в сила» names (P13): today, tomorrow and the first
 * day of the coming month — shop days, read off the shop's today.
 */
export type RhythmEffectivePresets = {
  readonly today: LocalDate;
  readonly tomorrow: LocalDate;
  /** The first day of the month after today's. */
  readonly firstOfMonth: LocalDate;
};

const NO_CHANGE: RhythmPatch = {
  enabled: null,
  qualifier: null,
  minGapDays: null,
  bookingHoldEnabled: null,
  bookingHoldMaxDaysPastDue: null,
  interval: null,
  graceDays: null,
  riskLeadDays: null,
  protectionsEnabled: null,
  protectionsMaxBanked: null,
  protectionsEarnEvery: null,
  protectionsStartWith: null,
  excuses: null,
  clientPauseEnabled: null,
  clientPauseMaxDaysPerYear: null,
  repairEnabled: null,
  repairWindowDays: null,
  repairPerYear: null,
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
function under(range: RhythmRange, interval: StreakIntervalRule): RhythmRange {
  return {
    min: range.min,
    max: Math.max(
      range.min,
      Math.min(range.max, StreakIntervalRule.shortestDays(interval) - 1),
    ),
  };
}

function intervalOf(
  held: StreakIntervalRule,
  patch: RhythmIntervalPatch | null,
  remembered: RememberedIntervals,
): StreakIntervalRule {
  if (patch === null) return StreakIntervalRule.of(held);
  const days = StreakIntervalRule.LIMITS.intervalDays;
  const tolerancePct = StreakIntervalRule.LIMITS.intervalTolerancePct;
  if (patch.streakInterval === StreakInterval.Fixed) {
    // Coming from a personal interval, the one number closest to it is the
    // newcomer's: what the rule already gave someone it did not know.
    const from =
      held.streakInterval === StreakInterval.Fixed
        ? held.intervalDays
        : (remembered.fixed?.intervalDays ?? held.intervalFallbackDays);
    return StreakIntervalRule.fixed(figure(patch.intervalDays, from, days));
  }
  const from: StreakIntervalRule.Personal =
    held.streakInterval === StreakInterval.Personal
      ? held
      : (remembered.personal ??
        StreakIntervalRule.personal(
          RECOMMENDED_PERSONAL.tolerancePct,
          RECOMMENDED_PERSONAL.minDays,
          RECOMMENDED_PERSONAL.maxDays,
          held.intervalDays,
        ));
  let minDays = figure(patch.intervalMinDays, from.intervalMinDays, days);
  let maxDays = figure(patch.intervalMaxDays, from.intervalMaxDays, days);
  // The figure in hand wins and the other end of the clamp follows it: a
  // floor typed above the ceiling lifts the ceiling, a ceiling typed under
  // the floor lowers the floor.
  if (minDays > maxDays) {
    if (patch.intervalMaxDays !== null) minDays = maxDays;
    else maxDays = minDays;
  }
  return StreakIntervalRule.personal(
    figure(patch.intervalTolerancePct, from.intervalTolerancePct, tolerancePct),
    minDays,
    maxDays,
    figure(patch.intervalFallbackDays, from.intervalFallbackDays, {
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

function sameQualifier(
  a: StreakQualifierRule,
  b: StreakQualifierRule,
): boolean {
  if (a.streakQualifier !== b.streakQualifier) return false;
  if (a.streakQualifier === StreakQualifier.Services) {
    return (
      b.streakQualifier === StreakQualifier.Services &&
      sameList(a.qualifierServiceIds, b.qualifierServiceIds)
    );
  }
  if (a.streakQualifier === StreakQualifier.Categories) {
    return (
      b.streakQualifier === StreakQualifier.Categories &&
      sameList(a.qualifierCategoryIds, b.qualifierCategoryIds)
    );
  }
  return true;
}

/** The interval a draft holds, as the change that names it whole. */
function intervalPatchOf(interval: StreakIntervalRule): RhythmIntervalPatch {
  return interval.streakInterval === StreakInterval.Fixed
    ? {
        streakInterval: StreakInterval.Fixed,
        intervalDays: interval.intervalDays,
      }
    : {
        streakInterval: StreakInterval.Personal,
        intervalTolerancePct: interval.intervalTolerancePct,
        intervalMinDays: interval.intervalMinDays,
        intervalMaxDays: interval.intervalMaxDays,
        intervalFallbackDays: interval.intervalFallbackDays,
      };
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
   * service chosen yet is no rule (`StreakRule.parse` says so). A draft is
   * foreign input (`StreakRuleInput`): its day is carried through as it is,
   * never read here — a parsed rule in is a rule out.
   */
  clamp<Day extends string>(
    draft: StreakRuleInput & { readonly effectiveFromLocalDate: Day },
    patch: RhythmPatch,
    remembered: RememberedIntervals,
    riskLeadChoices: readonly number[],
  ): StreakRuleInput & { readonly effectiveFromLocalDate: Day } {
    const limits = StreakRule.LIMITS;
    const interval = intervalOf(draft, patch.interval, remembered);
    const maxBanked = figure(
      patch.protectionsMaxBanked,
      draft.protectionsMaxBanked,
      limits.protectionsMaxBanked,
    );
    return {
      version: draft.version,
      effectiveFromLocalDate: draft.effectiveFromLocalDate,
      enabled: patch.enabled ?? draft.enabled,
      ...StreakQualifierRule.of(patch.qualifier ?? draft),
      minGapDays: figure(
        patch.minGapDays,
        draft.minGapDays,
        under(limits.minGapDays, interval),
      ),
      bookingHoldEnabled: patch.bookingHoldEnabled ?? draft.bookingHoldEnabled,
      bookingHoldMaxDaysPastDue: figure(
        patch.bookingHoldMaxDaysPastDue,
        draft.bookingHoldMaxDaysPastDue,
        limits.bookingHoldMaxDaysPastDue,
      ),
      ...interval,
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
      protectionsEnabled: patch.protectionsEnabled ?? draft.protectionsEnabled,
      protectionsMaxBanked: maxBanked,
      protectionsEarnEvery: figure(
        patch.protectionsEarnEvery,
        draft.protectionsEarnEvery,
        limits.protectionsEarnEvery,
      ),
      protectionsStartWith: figure(
        patch.protectionsStartWith,
        draft.protectionsStartWith,
        {
          min: limits.protectionsStartWith.min,
          max: Math.min(limits.protectionsStartWith.max, maxBanked),
        },
      ),
      excuses: excusesOf(patch.excuses ?? draft.excuses),
      clientPauseEnabled: patch.clientPauseEnabled ?? draft.clientPauseEnabled,
      clientPauseMaxDaysPerYear: figure(
        patch.clientPauseMaxDaysPerYear,
        draft.clientPauseMaxDaysPerYear,
        limits.clientPauseMaxDaysPerYear,
      ),
      repairEnabled: patch.repairEnabled ?? draft.repairEnabled,
      repairWindowDays: figure(
        patch.repairWindowDays,
        draft.repairWindowDays,
        limits.repairWindowDays,
      ),
      repairPerYear: figure(
        patch.repairPerYear,
        draft.repairPerYear,
        limits.repairPerYear,
      ),
      onBreak: patch.onBreak ?? draft.onBreak,
    };
  },

  /** The ranges that move with the draft. */
  bounds(draft: StreakRuleInput): RhythmBounds {
    const limits = StreakRule.LIMITS;
    return {
      graceDays: under(limits.graceDays, draft),
      riskLeadDays: under(limits.riskLeadDays, draft),
      minGapDays: under(limits.minGapDays, draft),
      startWith: {
        min: limits.protectionsStartWith.min,
        max: Math.min(
          limits.protectionsStartWith.max,
          draft.protectionsMaxBanked,
        ),
      },
      fallbackDays:
        draft.streakInterval === StreakInterval.Personal
          ? { min: draft.intervalMinDays, max: draft.intervalMaxDays }
          : limits.intervalDays,
    };
  },

  /**
   * The parameters of a draft that differ from the rule it was made on, as
   * the change that made them — what the admin did, apart from what the
   * rule already said. A part that differs is named whole (every field of
   * it); the rest `null`.
   */
  diff(draft: StreakRuleInput, madeOn: StreakRuleInput): RhythmPatch {
    const holdMoved =
      draft.bookingHoldEnabled !== madeOn.bookingHoldEnabled ||
      draft.bookingHoldMaxDaysPastDue !== madeOn.bookingHoldMaxDaysPastDue;
    const protectionsMoved =
      draft.protectionsEnabled !== madeOn.protectionsEnabled ||
      draft.protectionsMaxBanked !== madeOn.protectionsMaxBanked ||
      draft.protectionsEarnEvery !== madeOn.protectionsEarnEvery ||
      draft.protectionsStartWith !== madeOn.protectionsStartWith;
    const pauseMoved =
      draft.clientPauseEnabled !== madeOn.clientPauseEnabled ||
      draft.clientPauseMaxDaysPerYear !== madeOn.clientPauseMaxDaysPerYear;
    const repairMoved =
      draft.repairEnabled !== madeOn.repairEnabled ||
      draft.repairWindowDays !== madeOn.repairWindowDays ||
      draft.repairPerYear !== madeOn.repairPerYear;
    return {
      enabled: draft.enabled === madeOn.enabled ? null : draft.enabled,
      qualifier: sameQualifier(draft, madeOn)
        ? null
        : StreakQualifierRule.of(draft),
      minGapDays:
        draft.minGapDays === madeOn.minGapDays ? null : draft.minGapDays,
      bookingHoldEnabled: holdMoved ? draft.bookingHoldEnabled : null,
      bookingHoldMaxDaysPastDue: holdMoved
        ? draft.bookingHoldMaxDaysPastDue
        : null,
      interval: StreakIntervalRule.equals(draft, madeOn)
        ? null
        : intervalPatchOf(draft),
      graceDays: draft.graceDays === madeOn.graceDays ? null : draft.graceDays,
      riskLeadDays:
        draft.riskLeadDays === madeOn.riskLeadDays ? null : draft.riskLeadDays,
      protectionsEnabled: protectionsMoved ? draft.protectionsEnabled : null,
      protectionsMaxBanked: protectionsMoved
        ? draft.protectionsMaxBanked
        : null,
      protectionsEarnEvery: protectionsMoved
        ? draft.protectionsEarnEvery
        : null,
      protectionsStartWith: protectionsMoved
        ? draft.protectionsStartWith
        : null,
      excuses: sameList(draft.excuses, madeOn.excuses) ? null : draft.excuses,
      clientPauseEnabled: pauseMoved ? draft.clientPauseEnabled : null,
      clientPauseMaxDaysPerYear: pauseMoved
        ? draft.clientPauseMaxDaysPerYear
        : null,
      repairEnabled: repairMoved ? draft.repairEnabled : null,
      repairWindowDays: repairMoved ? draft.repairWindowDays : null,
      repairPerYear: repairMoved ? draft.repairPerYear : null,
      onBreak: draft.onBreak === madeOn.onBreak ? null : draft.onBreak,
    };
  },

  /**
   * What the draft remembers of the interval it HELD, before a change goes
   * over it: the interval of the kind it holds, kept beside the last one of
   * the other kind, so switching the kind and back loses nothing typed.
   */
  remember(
    remembered: RememberedIntervals,
    held: StreakIntervalRule,
  ): RememberedIntervals {
    return held.streakInterval === StreakInterval.Fixed
      ? { ...remembered, fixed: StreakIntervalRule.fixed(held.intervalDays) }
      : {
          ...remembered,
          personal: StreakIntervalRule.personal(
            held.intervalTolerancePct,
            held.intervalMinDays,
            held.intervalMaxDays,
            held.intervalFallbackDays,
          ),
        };
  },

  /**
   * A draft made on one rule, carried over another: what the admin changed
   * against the rule it was made on (`diff`) laid over the rule `now` holds
   * and clamped to it (`clamp`, the cue to the longest of `riskLeadChoices`
   * that fits) — so every parameter the admin did not touch follows the
   * rule as it now stands. What the rule the draft lands on is — the head
   * somebody else published, or the version a day turn brought into force —
   * is the caller's to know.
   */
  carryOver<Day extends string>(
    draft: StreakRuleInput,
    madeOn: StreakRuleInput,
    now: StreakRuleInput & { readonly effectiveFromLocalDate: Day },
    remembered: RememberedIntervals,
    riskLeadChoices: readonly number[],
  ): StreakRuleInput & { readonly effectiveFromLocalDate: Day } {
    return RhythmDraftSystem.clamp(
      now,
      RhythmDraftSystem.diff(draft, madeOn),
      remembered,
      riskLeadChoices,
    );
  },

  /**
   * The three days «Влизане в сила» names, off the shop's today: today,
   * tomorrow, and the first of the month after today's (civil arithmetic,
   * `LocalDate.addMonths` from the 1st).
   */
  effectivePresets(today: LocalDate): RhythmEffectivePresets {
    return {
      today,
      tomorrow: LocalDate.addDays(today, 1),
      firstOfMonth: LocalDate.addMonths(LocalDate.startOfMonth(today), 1),
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

  /**
   * Which of the page's three «От» choices (P13) the effective day in hand
   * is: tomorrow, the first of the coming month, or a day the admin picked.
   * Tomorrow wins a tie — on a month's last day it IS the first of the next
   * (`admin-rhythm.words.ts` `effectiveReading`).
   */
  effectiveChoiceOf(
    day: LocalDate,
    presets: {
      readonly tomorrow: LocalDate;
      readonly firstOfMonth: LocalDate;
    },
  ): RhythmEffectiveChoice {
    if (day === presets.tomorrow) return RhythmEffectiveChoice.Tomorrow;
    if (day === presets.firstOfMonth) {
      return RhythmEffectiveChoice.FirstOfMonth;
    }
    return RhythmEffectiveChoice.Picked;
  },
} as const;
