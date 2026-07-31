/**
 * A half-open interval of epoch milliseconds, `[startMs, endMs)`.
 *
 * **Why integers and not `ZonedDateTime`.** Availability is set arithmetic —
 * subtract busy from working, intersect with policy, slide a duration through
 * what remains. Doing that on wall-clock values means every comparison carries
 * a timezone question, and the Europe/Sofia transitions turn one of those
 * questions into a wrong answer twice a year. Converting to instants once at
 * the boundary and back once at the end removes DST from the inner loop
 * entirely: `10:00+03:00` and `10:00+02:00` are simply different integers.
 *
 * **Half-open is load-bearing.** `[10:00, 10:45)` and `[10:45, 11:15)` do not
 * overlap, which is exactly what lets one barber take a party's second seat
 * the instant the first ends — the sequential arrangement the product depends
 * on. A closed interval would make every back-to-back booking a conflict.
 *
 * A valid interval has `startMs < endMs`; zero-length intervals are dropped by
 * every operation rather than propagated, because "a gap of no time" is never
 * something a caller wants to reason about.
 */
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

function isNonEmpty(interval: Interval): boolean {
  return interval.startMs < interval.endMs;
}

function byStart(a: Interval, b: Interval): number {
  return a.startMs - b.startMs || a.endMs - b.endMs;
}

export const Interval = {
  of(startMs: number, endMs: number): Interval {
    return { startMs, endMs };
  },

  durationMinutes(interval: Interval): number {
    return (interval.endMs - interval.startMs) / 60_000;
  },

  overlaps(a: Interval, b: Interval): boolean {
    return a.startMs < b.endMs && b.startMs < a.endMs;
  },

  contains(outer: Interval, inner: Interval): boolean {
    return outer.startMs <= inner.startMs && inner.endMs <= outer.endMs;
  },

  /**
   * Sorted, non-overlapping, non-touching — the canonical form every other
   * operation assumes and returns.
   *
   * Touching intervals are MERGED (`[9,10)` + `[10,11)` → `[9,11)`): as a set
   * of instants they are one continuous run, and leaving them split would let
   * a service that fits the union be rejected because it fits neither half.
   */
  normalize(intervals: readonly Interval[]): readonly Interval[] {
    const sorted = intervals.filter(isNonEmpty).slice().sort(byStart);
    const merged: Interval[] = [];
    for (const next of sorted) {
      const last = merged[merged.length - 1];
      if (last && next.startMs <= last.endMs) {
        merged[merged.length - 1] = {
          startMs: last.startMs,
          endMs: Math.max(last.endMs, next.endMs),
        };
      } else {
        merged.push(next);
      }
    }
    return merged;
  },

  /**
   * `base − cut` — the free time left after removing what is taken. THE
   * operation availability is built from: working windows minus busy blocks.
   */
  subtract(
    base: readonly Interval[],
    cut: readonly Interval[],
  ): readonly Interval[] {
    const cuts = Interval.normalize(cut);
    const result: Interval[] = [];

    for (const window of Interval.normalize(base)) {
      let cursor = window.startMs;
      for (const taken of cuts) {
        if (taken.endMs <= cursor) continue;
        if (taken.startMs >= window.endMs) break;
        if (taken.startMs > cursor) {
          result.push({ startMs: cursor, endMs: taken.startMs });
        }
        cursor = Math.max(cursor, taken.endMs);
        if (cursor >= window.endMs) break;
      }
      if (cursor < window.endMs) {
        result.push({ startMs: cursor, endMs: window.endMs });
      }
    }
    return result.filter(isNonEmpty);
  },

  intersect(
    left: readonly Interval[],
    right: readonly Interval[],
  ): readonly Interval[] {
    const a = Interval.normalize(left);
    const b = Interval.normalize(right);
    const result: Interval[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const start = Math.max(
        (a[i] as Interval).startMs,
        (b[j] as Interval).startMs,
      );
      const end = Math.min((a[i] as Interval).endMs, (b[j] as Interval).endMs);
      if (start < end) result.push({ startMs: start, endMs: end });
      if ((a[i] as Interval).endMs < (b[j] as Interval).endMs) i++;
      else j++;
    }
    return result;
  },

  union(
    left: readonly Interval[],
    right: readonly Interval[],
  ): readonly Interval[] {
    return Interval.normalize([...left, ...right]);
  },

  /**
   * Grow an interval outward by the given minutes — how a buffer is applied.
   *
   * Padding is applied to the BUSY interval, never to the candidate slot: pad
   * both and a uniform turnaround produces twice the intended gap. See
   * `docs/design-research/availability-and-statistics-design.md` §9a R3.
   */
  pad(
    interval: Interval,
    beforeMinutes: number,
    afterMinutes: number,
  ): Interval {
    return {
      startMs: interval.startMs - beforeMinutes * 60_000,
      endMs: interval.endMs + afterMinutes * 60_000,
    };
  },

  /** Clip to a bound, dropping anything that falls entirely outside it. */
  clip(intervals: readonly Interval[], bound: Interval): readonly Interval[] {
    return Interval.intersect(intervals, [bound]);
  },

  /** Total minutes covered. Normalizes first, so overlaps are never counted twice. */
  totalMinutes(intervals: readonly Interval[]): number {
    return Interval.normalize(intervals).reduce(
      (total, interval) => total + Interval.durationMinutes(interval),
      0,
    );
  },

  equals(a: Interval, b: Interval): boolean {
    return a.startMs === b.startMs && a.endMs === b.endMs;
  },
} as const;
