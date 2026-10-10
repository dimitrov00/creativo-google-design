import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from './engagement-errors.data';
import { Result } from './result.data';

/** How long a period of the rhythm lasts, by kind — the stored tags, unchanged. */
export const StreakIntervalKind = {
  /** One number for everyone, «на всеки 6 седмици». */
  Fixed: 'fixed',
  /** The client's own habit plus a tolerance, held between a floor and a ceiling. */
  Personal: 'personal',
} as const;
export type StreakIntervalKind =
  (typeof StreakIntervalKind)[keyof typeof StreakIntervalKind];

/** Where a period's length came from: the rule's one number, the person's habit, or the newcomer's default. */
export const StreakIntervalSource = {
  Fixed: 'fixed',
  Personal: 'personal',
  Fallback: 'fallback',
} as const;
export type StreakIntervalSource =
  (typeof StreakIntervalSource)[keyof typeof StreakIntervalSource];

const STREAK_INTERVAL_KINDS: readonly StreakIntervalKind[] =
  Object.values(StreakIntervalKind);

/** The interval's ranges, inclusive: two weeks to half a year. */
const LIMITS = {
  days: { min: 14, max: 182 },
  tolerancePct: { min: 0, max: 100 },
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
 * edited in weeks, held in whole days (`streak-interval.ts`). The ONE place
 * a period's length is computed (`daysFor`), so the projector, the preview
 * and the card's sentence cannot disagree about a due date.
 */
export type StreakInterval = StreakInterval.Fixed | StreakInterval.Personal;

export const StreakInterval = {
  /** The ranges `parse` refuses by and an editor clamps to — one table, so the two cannot drift. */
  LIMITS,

  fixed(days: number): StreakInterval.Fixed {
    return { kind: StreakIntervalKind.Fixed, days };
  },

  personal(
    tolerancePct: number,
    minDays: number,
    maxDays: number,
    fallbackDays: number,
  ): StreakInterval.Personal {
    return {
      kind: StreakIntervalKind.Personal,
      tolerancePct,
      minDays,
      maxDays,
      fallbackDays,
    };
  },

  /**
   * The edge guard: every figure a whole number in its range, and a clamp
   * that does not contradict itself — judged only over figures that are
   * themselves sound (a floor of 3 days is ONE fault, not also "the
   * fallback is outside"). Every fault at once. Returns a fresh struct.
   */
  parse(
    raw: StreakInterval,
  ): Result<StreakInterval, readonly EngagementError.StreakRuleError[]> {
    const errors: EngagementError.StreakRuleError[] = [];
    if (raw.kind === StreakIntervalKind.Fixed) {
      if (!wholeWithin(raw.days, LIMITS.days)) {
        errors.push(outOfDays(StreakRuleField.IntervalDays, raw.days));
      }
      return errors.length > 0
        ? Result.err(errors)
        : Result.ok(StreakInterval.fixed(raw.days));
    }
    if (raw.kind !== StreakIntervalKind.Personal) {
      return Result.err([
        EngagementError.streakUnknownOption(
          StreakRuleField.IntervalKind,
          (raw as { readonly kind: unknown }).kind,
          STREAK_INTERVAL_KINDS,
        ),
      ]);
    }
    if (!wholeWithin(raw.tolerancePct, LIMITS.tolerancePct)) {
      errors.push(
        EngagementError.streakRuleRange(
          EngagementErrorCode.StreakToleranceOutOfRange,
          StreakRuleField.IntervalTolerancePct,
          raw.tolerancePct,
          LIMITS.tolerancePct.min,
          LIMITS.tolerancePct.max,
        ),
      );
    }
    let boundsHold = true;
    if (!wholeWithin(raw.minDays, LIMITS.days)) {
      boundsHold = false;
      errors.push(outOfDays(StreakRuleField.IntervalMinDays, raw.minDays));
    }
    if (!wholeWithin(raw.maxDays, LIMITS.days)) {
      boundsHold = false;
      errors.push(outOfDays(StreakRuleField.IntervalMaxDays, raw.maxDays));
    }
    if (!wholeWithin(raw.fallbackDays, LIMITS.days)) {
      boundsHold = false;
      errors.push(
        outOfDays(StreakRuleField.IntervalFallbackDays, raw.fallbackDays),
      );
    }
    if (boundsHold) {
      if (raw.minDays > raw.maxDays) {
        errors.push(
          EngagementError.streakClampInverted(raw.minDays, raw.maxDays),
        );
      } else if (
        raw.fallbackDays < raw.minDays ||
        raw.fallbackDays > raw.maxDays
      ) {
        errors.push(
          EngagementError.streakFallbackOutsideClamp(
            raw.fallbackDays,
            raw.minDays,
            raw.maxDays,
          ),
        );
      }
    }
    return errors.length > 0
      ? Result.err(errors)
      : Result.ok(
          StreakInterval.personal(
            raw.tolerancePct,
            raw.minDays,
            raw.maxDays,
            raw.fallbackDays,
          ),
        );
  },

  /**
   * The days of the period that opens now. `habitDays` is the mean of the
   * person's last counted gaps, or `null` while nobody knows the habit
   * (then the newcomer's `fallbackDays`). The habit is stretched by the
   * tolerance, rounded to a whole day, and held between the floor and the
   * ceiling. The projector pins the answer on the period it opens
   * (`StreakState.period`), so a later visit never moves a promised due date.
   */
  daysFor(
    interval: StreakInterval,
    habitDays: number | null,
  ): StreakInterval.Period {
    if (interval.kind === StreakIntervalKind.Fixed) {
      return { days: interval.days, source: StreakIntervalSource.Fixed };
    }
    if (habitDays === null || !Number.isFinite(habitDays) || habitDays <= 0) {
      return {
        days: interval.fallbackDays,
        source: StreakIntervalSource.Fallback,
      };
    }
    const stretched = Math.round(
      (habitDays * (100 + interval.tolerancePct)) / 100,
    );
    return {
      days: Math.min(interval.maxDays, Math.max(interval.minDays, stretched)),
      source: StreakIntervalSource.Personal,
    };
  },

  /** The shortest period this interval can open: what grace, the cue and the minimum gap stay under. */
  shortestDays(interval: StreakInterval): number {
    return interval.kind === StreakIntervalKind.Fixed
      ? interval.days
      : interval.minDays;
  },

  /** The longest period this interval can open. */
  longestDays(interval: StreakInterval): number {
    return interval.kind === StreakIntervalKind.Fixed
      ? interval.days
      : interval.maxDays;
  },

  /** Same kind, figure by figure. */
  equals(a: StreakInterval, b: StreakInterval): boolean {
    if (a.kind === StreakIntervalKind.Fixed) {
      return b.kind === StreakIntervalKind.Fixed && a.days === b.days;
    }
    return (
      b.kind === StreakIntervalKind.Personal &&
      a.tolerancePct === b.tolerancePct &&
      a.minDays === b.minDays &&
      a.maxDays === b.maxDays &&
      a.fallbackDays === b.fallbackDays
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
    LIMITS.days.min,
    LIMITS.days.max,
  );
}

export namespace StreakInterval {
  export type Fixed = {
    readonly kind: typeof StreakIntervalKind.Fixed;
    readonly days: number;
  };
  export type Personal = {
    readonly kind: typeof StreakIntervalKind.Personal;
    /** How far past the habit a period stretches, in percent. */
    readonly tolerancePct: number;
    readonly minDays: number;
    readonly maxDays: number;
    /** A new client's interval, while nobody knows the habit. */
    readonly fallbackDays: number;
  };
  /** A period's length and where it came from — what `daysFor` answers. */
  export type Period = {
    readonly days: number;
    readonly source: StreakIntervalSource;
  };
}
