import { IntervalSetSystem, TimeInterval } from '@creativo/ecs-core';

/**
 * A half-open interval of epoch milliseconds, `[startMs, endMs)`.
 *
 * **Why integers and not `ZonedDateTime`.** Availability is set arithmetic —
 * subtract busy from working, intersect with policy, slide a duration through
 * what remains. Converting to instants once at the boundary and back once at
 * the end removes DST from the inner loop entirely.
 *
 * **Half-open is load-bearing.** `[10:00, 10:45)` and `[10:45, 11:15)` do not
 * overlap, which is exactly what lets one barber take a party's second seat
 * the instant the first ends.
 *
 * Phase 2 shim: the shape is `TimeInterval` and the algebra is
 * `IntervalSetSystem` in `@creativo/ecs-core`; this companion keeps the
 * legacy name for its callers.
 */
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

export const Interval = {
  of(startMs: number, endMs: number): Interval {
    return TimeInterval.of(startMs, endMs);
  },

  durationMinutes(interval: Interval): number {
    return TimeInterval.durationMinutes(interval);
  },

  overlaps(a: Interval, b: Interval): boolean {
    return TimeInterval.overlaps(a, b);
  },

  contains(outer: Interval, inner: Interval): boolean {
    return TimeInterval.contains(outer, inner);
  },

  /**
   * Sorted, non-overlapping, non-touching — the canonical form every other
   * operation assumes and returns. Touching intervals are MERGED.
   */
  normalize(intervals: readonly Interval[]): readonly Interval[] {
    return IntervalSetSystem.normalize(intervals);
  },

  /** `base − cut` — the free time left after removing what is taken. */
  subtract(
    base: readonly Interval[],
    cut: readonly Interval[],
  ): readonly Interval[] {
    return IntervalSetSystem.subtract(base, cut);
  },

  intersect(
    left: readonly Interval[],
    right: readonly Interval[],
  ): readonly Interval[] {
    return IntervalSetSystem.intersect(left, right);
  },

  union(
    left: readonly Interval[],
    right: readonly Interval[],
  ): readonly Interval[] {
    return IntervalSetSystem.union(left, right);
  },

  /**
   * Grow an interval outward by the given minutes — how a buffer is applied.
   * Padding goes on the BUSY interval, never on the candidate slot.
   */
  pad(
    interval: Interval,
    beforeMinutes: number,
    afterMinutes: number,
  ): Interval {
    return TimeInterval.pad(interval, beforeMinutes, afterMinutes);
  },

  /** Clip to a bound, dropping anything that falls entirely outside it. */
  clip(intervals: readonly Interval[], bound: Interval): readonly Interval[] {
    return IntervalSetSystem.clip(intervals, bound);
  },

  /** Total minutes covered. Normalizes first, so overlaps are never counted twice. */
  totalMinutes(intervals: readonly Interval[]): number {
    return IntervalSetSystem.totalMinutes(intervals);
  },

  equals(a: Interval, b: Interval): boolean {
    return TimeInterval.equals(a, b);
  },
} as const;
