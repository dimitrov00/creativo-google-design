import { Result } from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from '@core/errors';

/** How long a period of the rhythm lasts — the rule's discriminator `streakInterval`. */
export const StreakInterval = {
  /** One number for everyone, «на всеки 6 седмици». */
  Fixed: 'FIXED',
  /** The client's own habit plus a tolerance, held between a floor and a ceiling. */
  Personal: 'PERSONAL',
} as const;
export type StreakInterval =
  (typeof StreakInterval)[keyof typeof StreakInterval];

/** Where a period's length came from: the rule's one number, the person's habit, or the newcomer's default. */
export const StreakIntervalSource = {
  Fixed: 'FIXED',
  Personal: 'PERSONAL',
  Fallback: 'FALLBACK',
} as const;
export type StreakIntervalSource =
  (typeof StreakIntervalSource)[keyof typeof StreakIntervalSource];

const STREAK_INTERVALS: readonly StreakInterval[] =
  Object.values(StreakInterval);

/** The interval's ranges, inclusive, by the flat fields they bound: two weeks to half a year (every `interval*Days`). */
const LIMITS = {
  intervalDays: { min: 14, max: 182 },
  intervalTolerancePct: { min: 0, max: 100 },
} as const;

type Whole = { readonly min: number; readonly max: number };

function wholeWithin(value: unknown, range: Whole): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/**
 * How long a period of the rhythm lasts (client-card revision 3 §4.1, P5) —
 * edited in weeks, held in whole days (`streak-interval.ts`). A variant
 * SLICE of the flat `StreakRule`, discriminated by `streakInterval`, every
 * figure prefixed `interval`. The ONE place a period's length is computed
 * (`daysFor`), so the projector, the preview and the card's sentence
 * cannot disagree about a due date.
 */
export type StreakIntervalRule =
  StreakIntervalRule.Fixed | StreakIntervalRule.Personal;

export const StreakIntervalRule = {
  /** The ranges `parse` refuses by and an editor clamps to — one table, so the two cannot drift. */
  LIMITS,

  fixed(intervalDays: number): StreakIntervalRule.Fixed {
    return { streakInterval: StreakInterval.Fixed, intervalDays };
  },

  personal(
    intervalTolerancePct: number,
    intervalMinDays: number,
    intervalMaxDays: number,
    intervalFallbackDays: number,
  ): StreakIntervalRule.Personal {
    return {
      streakInterval: StreakInterval.Personal,
      intervalTolerancePct,
      intervalMinDays,
      intervalMaxDays,
      intervalFallbackDays,
    };
  },

  /**
   * The interval fields of a rule (or of any struct carrying the slice), as
   * a fresh slice of their own — never the rule's other fields.
   */
  of(interval: StreakIntervalRule): StreakIntervalRule {
    return interval.streakInterval === StreakInterval.Fixed
      ? StreakIntervalRule.fixed(interval.intervalDays)
      : StreakIntervalRule.personal(
          interval.intervalTolerancePct,
          interval.intervalMinDays,
          interval.intervalMaxDays,
          interval.intervalFallbackDays,
        );
  },

  /**
   * The edge guard: every figure a whole number in its range, and a clamp
   * that does not contradict itself — judged only over figures that are
   * themselves sound (a floor of 3 days is ONE fault, not also "the
   * fallback is outside"). Every fault at once. Returns a fresh slice.
   */
  parse(
    raw: StreakIntervalRule,
  ): Result<StreakIntervalRule, readonly EngagementError.StreakRuleError[]> {
    const errors: EngagementError.StreakRuleError[] = [];
    if (raw.streakInterval === StreakInterval.Fixed) {
      if (!wholeWithin(raw.intervalDays, LIMITS.intervalDays)) {
        errors.push(outOfDays(StreakRuleField.IntervalDays, raw.intervalDays));
      }
      return errors.length > 0
        ? Result.err(errors)
        : Result.ok(StreakIntervalRule.fixed(raw.intervalDays));
    }
    if (raw.streakInterval !== StreakInterval.Personal) {
      return Result.err([
        EngagementError.streakUnknownOption(
          StreakRuleField.IntervalKind,
          (raw as { readonly streakInterval: unknown }).streakInterval,
          STREAK_INTERVALS,
        ),
      ]);
    }
    if (!wholeWithin(raw.intervalTolerancePct, LIMITS.intervalTolerancePct)) {
      errors.push(
        EngagementError.streakRuleRange(
          EngagementErrorCode.StreakToleranceOutOfRange,
          StreakRuleField.IntervalTolerancePct,
          raw.intervalTolerancePct,
          LIMITS.intervalTolerancePct.min,
          LIMITS.intervalTolerancePct.max,
        ),
      );
    }
    let boundsHold = true;
    if (!wholeWithin(raw.intervalMinDays, LIMITS.intervalDays)) {
      boundsHold = false;
      errors.push(
        outOfDays(StreakRuleField.IntervalMinDays, raw.intervalMinDays),
      );
    }
    if (!wholeWithin(raw.intervalMaxDays, LIMITS.intervalDays)) {
      boundsHold = false;
      errors.push(
        outOfDays(StreakRuleField.IntervalMaxDays, raw.intervalMaxDays),
      );
    }
    if (!wholeWithin(raw.intervalFallbackDays, LIMITS.intervalDays)) {
      boundsHold = false;
      errors.push(
        outOfDays(
          StreakRuleField.IntervalFallbackDays,
          raw.intervalFallbackDays,
        ),
      );
    }
    if (boundsHold) {
      if (raw.intervalMinDays > raw.intervalMaxDays) {
        errors.push(
          EngagementError.streakClampInverted(
            raw.intervalMinDays,
            raw.intervalMaxDays,
          ),
        );
      } else if (
        raw.intervalFallbackDays < raw.intervalMinDays ||
        raw.intervalFallbackDays > raw.intervalMaxDays
      ) {
        errors.push(
          EngagementError.streakFallbackOutsideClamp(
            raw.intervalFallbackDays,
            raw.intervalMinDays,
            raw.intervalMaxDays,
          ),
        );
      }
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok(
          StreakIntervalRule.personal(
            raw.intervalTolerancePct,
            raw.intervalMinDays,
            raw.intervalMaxDays,
            raw.intervalFallbackDays,
          ),
        );
  },

  /**
   * The days of the period that opens now. `habitDays` is the mean of the
   * person's last counted gaps, or `null` while nobody knows the habit
   * (then the newcomer's `intervalFallbackDays`). The habit is stretched by
   * the tolerance, rounded to a whole day, and held between the floor and
   * the ceiling. The projector pins the answer on the period it opens
   * (`StreakState.periodIntervalDays`), so a later visit never moves a
   * promised due date.
   */
  daysFor(
    interval: StreakIntervalRule,
    habitDays: number | null,
  ): StreakIntervalRule.Period {
    if (interval.streakInterval === StreakInterval.Fixed) {
      return {
        days: interval.intervalDays,
        source: StreakIntervalSource.Fixed,
      };
    }
    if (habitDays === null || !Number.isFinite(habitDays) || habitDays <= 0) {
      return {
        days: interval.intervalFallbackDays,
        source: StreakIntervalSource.Fallback,
      };
    }
    const stretched = Math.round(
      (habitDays * (100 + interval.intervalTolerancePct)) / 100,
    );
    return {
      days: Math.min(
        interval.intervalMaxDays,
        Math.max(interval.intervalMinDays, stretched),
      ),
      source: StreakIntervalSource.Personal,
    };
  },

  /** The shortest period this interval can open: what grace, the cue and the minimum gap stay under. */
  shortestDays(interval: StreakIntervalRule): number {
    return interval.streakInterval === StreakInterval.Fixed
      ? interval.intervalDays
      : interval.intervalMinDays;
  },

  /** The longest period this interval can open. */
  longestDays(interval: StreakIntervalRule): number {
    return interval.streakInterval === StreakInterval.Fixed
      ? interval.intervalDays
      : interval.intervalMaxDays;
  },

  /** Same kind, figure by figure. */
  equals(a: StreakIntervalRule, b: StreakIntervalRule): boolean {
    if (a.streakInterval === StreakInterval.Fixed) {
      return (
        b.streakInterval === StreakInterval.Fixed &&
        a.intervalDays === b.intervalDays
      );
    }
    return (
      b.streakInterval === StreakInterval.Personal &&
      a.intervalTolerancePct === b.intervalTolerancePct &&
      a.intervalMinDays === b.intervalMinDays &&
      a.intervalMaxDays === b.intervalMaxDays &&
      a.intervalFallbackDays === b.intervalFallbackDays
    );
  },
} as const;

function outOfDays(
  field: StreakRuleField,
  value: unknown,
): EngagementError.StreakRange {
  return EngagementError.streakRuleRange(
    EngagementErrorCode.StreakIntervalOutOfRange,
    field,
    value,
    LIMITS.intervalDays.min,
    LIMITS.intervalDays.max,
  );
}

export namespace StreakIntervalRule {
  export type Fixed = {
    readonly streakInterval: typeof StreakInterval.Fixed;
    readonly intervalDays: number;
  };
  export type Personal = {
    readonly streakInterval: typeof StreakInterval.Personal;
    /** How far past the habit a period stretches, in percent. */
    readonly intervalTolerancePct: number;
    readonly intervalMinDays: number;
    readonly intervalMaxDays: number;
    /** A new client's interval, while nobody knows the habit. */
    readonly intervalFallbackDays: number;
  };
  /** A period's length and where it came from — what `daysFor` answers (a system value). */
  export type Period = {
    readonly days: number;
    readonly source: StreakIntervalSource;
  };
}
