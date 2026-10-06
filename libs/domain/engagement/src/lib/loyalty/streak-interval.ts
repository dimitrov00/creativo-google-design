import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  StreakClampInvertedError,
  StreakDefinitionError,
  StreakFallbackOutsideClampError,
  StreakIntervalOutOfRangeError,
  StreakToleranceOutOfRangeError,
  StreakUnknownOptionError,
} from './streak-definition.errors';

/**
 * How long a period of the rhythm lasts (client-card revision 3 §4.1, P5).
 * Edited in weeks, held in days.
 *
 * - `fixed`: one number for everyone, «на всеки 6 седмици».
 * - `personal`: the client's own habit plus a tolerance, held between a
 *   floor and a ceiling; a new client, whose habit nobody knows yet, gets
 *   `fallbackDays`.
 */
export type StreakIntervalProps =
  | { kind: 'fixed'; days: number }
  | {
      kind: 'personal';
      tolerancePct: number;
      minDays: number;
      maxDays: number;
      fallbackDays: number;
    };

export const STREAK_INTERVAL_KINDS = ['fixed', 'personal'] as const;

/** The interval's ranges, inclusive: two weeks to half a year. */
export const STREAK_INTERVAL_LIMITS = {
  days: { min: 14, max: 182 },
  tolerancePct: { min: 0, max: 100 },
} as const;

/** Where a period's length came from: the rule's one number, the person's habit, or the newcomer's default. */
export type StreakIntervalSource = 'fixed' | 'personal' | 'fallback';

const wholeWithin = (
  value: unknown,
  range: { readonly min: number; readonly max: number },
): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= range.min &&
  value <= range.max;

/**
 * The interval as a value: it refuses a number outside its range and a
 * clamp that contradicts itself, and it is the ONE place a period's length
 * is computed, so the projector, the preview and the card's sentence cannot
 * disagree about a due date.
 */
export class StreakInterval {
  private constructor(private readonly props: StreakIntervalProps) {}

  static create(
    props: StreakIntervalProps,
  ): Result<StreakInterval, StreakDefinitionError[]> {
    const { days, tolerancePct } = STREAK_INTERVAL_LIMITS;
    const errors: StreakDefinitionError[] = [];

    if (props.kind === 'fixed') {
      if (!wholeWithin(props.days, days)) {
        errors.push(
          new StreakIntervalOutOfRangeError(
            'interval.days',
            props.days,
            days.min,
            days.max,
          ),
        );
      }
      return errors.length > 0
        ? fail(errors)
        : ok(new StreakInterval({ kind: 'fixed', days: props.days }));
    }

    if (props.kind !== 'personal') {
      return fail([
        new StreakUnknownOptionError(
          'interval.kind',
          (props as { kind?: unknown }).kind,
          STREAK_INTERVAL_KINDS,
        ),
      ]);
    }

    if (!wholeWithin(props.tolerancePct, tolerancePct)) {
      errors.push(
        new StreakToleranceOutOfRangeError(
          props.tolerancePct,
          tolerancePct.min,
          tolerancePct.max,
        ),
      );
    }
    const bounds = [
      ['interval.minDays', props.minDays],
      ['interval.maxDays', props.maxDays],
      ['interval.fallbackDays', props.fallbackDays],
    ] as const;
    let boundsHold = true;
    for (const [field, value] of bounds) {
      if (wholeWithin(value, days)) continue;
      boundsHold = false;
      errors.push(
        new StreakIntervalOutOfRangeError(field, value, days.min, days.max),
      );
    }
    // The clamp is judged only over numbers that are themselves sound: a
    // floor of 3 days is ONE fault, not also "the fallback is outside".
    if (boundsHold) {
      if (props.minDays > props.maxDays) {
        errors.push(new StreakClampInvertedError(props.minDays, props.maxDays));
      } else if (
        props.fallbackDays < props.minDays ||
        props.fallbackDays > props.maxDays
      ) {
        errors.push(
          new StreakFallbackOutsideClampError(
            props.fallbackDays,
            props.minDays,
            props.maxDays,
          ),
        );
      }
    }

    if (errors.length > 0) return fail(errors);
    return ok(
      new StreakInterval({
        kind: 'personal',
        tolerancePct: props.tolerancePct,
        minDays: props.minDays,
        maxDays: props.maxDays,
        fallbackDays: props.fallbackDays,
      }),
    );
  }

  get kind(): StreakIntervalProps['kind'] {
    return this.props.kind;
  }

  /**
   * The days of the period that opens now. `habitDays` is the mean of the
   * person's last six counted gaps, or `null` while nobody knows the habit.
   * The projector pins the answer on the period it opens
   * (`StreakState.period`), so a later visit never moves a due date that
   * was already promised.
   */
  daysFor(habitDays: number | null): {
    readonly days: number;
    readonly source: StreakIntervalSource;
  } {
    const props = this.props;
    if (props.kind === 'fixed') return { days: props.days, source: 'fixed' };
    if (habitDays === null || !Number.isFinite(habitDays) || habitDays <= 0) {
      return { days: props.fallbackDays, source: 'fallback' };
    }
    const stretched = Math.round(
      (habitDays * (100 + props.tolerancePct)) / 100,
    );
    return {
      days: Math.min(props.maxDays, Math.max(props.minDays, stretched)),
      source: 'personal',
    };
  }

  /** The shortest period this interval can open: what grace, the cue and the minimum gap stay under. */
  get shortestDays(): number {
    return this.props.kind === 'fixed' ? this.props.days : this.props.minDays;
  }

  /** The longest period this interval can open. */
  get longestDays(): number {
    return this.props.kind === 'fixed' ? this.props.days : this.props.maxDays;
  }

  equals(other: StreakInterval): boolean {
    const a = this.props;
    const b = other.props;
    if (a.kind === 'fixed') return b.kind === 'fixed' && a.days === b.days;
    return (
      b.kind === 'personal' &&
      a.tolerancePct === b.tolerancePct &&
      a.minDays === b.minDays &&
      a.maxDays === b.maxDays &&
      a.fallbackDays === b.fallbackDays
    );
  }

  /** A fresh copy of the numbers: what the document and the editor's draft hold. */
  toProps(): StreakIntervalProps {
    return { ...this.props };
  }
}
