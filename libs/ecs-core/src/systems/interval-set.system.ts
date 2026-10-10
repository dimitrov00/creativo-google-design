import { TimeInterval } from '../components/time-interval.data';

/**
 * A canonical interval set: sorted by `startMs`, non-empty, pairwise
 * disjoint AND non-touching (touching runs are merged). Every operation of
 * {@link IntervalSetSystem} returns one; the brand flags it so a hot caller
 * can hold its sets normalized and hand them back in.
 */
export type NormalizedIntervals = readonly TimeInterval[] & {
  readonly __normalized: unique symbol;
};

function byStart(a: TimeInterval, b: TimeInterval): number {
  return a.startMs - b.startMs || a.endMs - b.endMs;
}

/** The one cast site of the brand: `xs` is already in canonical form. */
function asNormalized(xs: readonly TimeInterval[]): NormalizedIntervals {
  return xs as NormalizedIntervals;
}

/** One linear pass: is `xs` canonical already? (No allocation.) */
function isNormalized(xs: readonly TimeInterval[]): boolean {
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as TimeInterval;
    if (!(x.startMs < x.endMs) || x.startMs <= lastEnd) return false;
    lastEnd = x.endMs;
  }
  return true;
}

/**
 * Set algebra over half-open epoch-ms intervals — the arithmetic availability
 * is built from (working windows minus busy blocks, intersected with policy).
 *
 * Inputs are read, never written. Each operation first brings its inputs to
 * canonical form: an input that already is one (every output of this
 * system) is used as-is after one linear check — no copy, no sort — so a
 * caller that keeps its sets normalized pays O(n) per operation; anything
 * else is copied, sorted once and merged.
 */
export const IntervalSetSystem = {
  /**
   * Sorted, non-overlapping, non-touching; empty and inverted intervals
   * dropped. Touching runs MERGE (`[9,10)` + `[10,11)` → `[9,11)`): as a set
   * of instants they are one run, and leaving them split would reject a
   * service that fits the union because it fits neither half.
   * Idempotent: a normalized input comes back unchanged.
   */
  normalize(xs: readonly TimeInterval[]): NormalizedIntervals {
    if (isNormalized(xs)) return asNormalized(xs);
    const sorted: TimeInterval[] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as TimeInterval;
      if (x.startMs < x.endMs) sorted.push(x);
    }
    sorted.sort(byStart);
    const merged: TimeInterval[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[i] as TimeInterval;
      const last = merged[merged.length - 1];
      if (last !== undefined && next.startMs <= last.endMs) {
        if (next.endMs > last.endMs) {
          merged[merged.length - 1] = TimeInterval.of(last.startMs, next.endMs);
        }
      } else {
        merged.push(next);
      }
    }
    return asNormalized(merged);
  },

  /**
   * `base − cut` — the free time left after removing what is taken. One
   * merge-style pass over both sorted sets: O(n + m). A cut that merely
   * touches a window consumes nothing (half-open), which is what lets one
   * barber take a party's next seat the instant the previous one ends.
   */
  subtract(
    base: readonly TimeInterval[],
    cut: readonly TimeInterval[],
  ): NormalizedIntervals {
    const windows = IntervalSetSystem.normalize(base);
    const cuts = IntervalSetSystem.normalize(cut);
    if (cuts.length === 0) return windows;
    const out: TimeInterval[] = [];
    let j = 0;
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i] as TimeInterval;
      // Cuts ending at or before this window cannot touch any later window.
      while (
        j < cuts.length &&
        (cuts[j] as TimeInterval).endMs <= window.startMs
      ) {
        j++;
      }
      let cursor = window.startMs;
      for (let k = j; k < cuts.length; k++) {
        const taken = cuts[k] as TimeInterval;
        if (taken.startMs >= window.endMs) break;
        if (taken.startMs > cursor)
          out.push(TimeInterval.of(cursor, taken.startMs));
        // Cuts are disjoint and sorted, and those ending at or before the
        // window were skipped, so every cut reached here ends past `cursor`.
        cursor = taken.endMs;
        if (cursor >= window.endMs) break;
      }
      if (cursor < window.endMs)
        out.push(TimeInterval.of(cursor, window.endMs));
    }
    return asNormalized(out);
  },

  /** `a ∩ b` — a two-pointer sweep, O(n + m). Touching runs share nothing. */
  intersect(
    left: readonly TimeInterval[],
    right: readonly TimeInterval[],
  ): NormalizedIntervals {
    const a = IntervalSetSystem.normalize(left);
    const b = IntervalSetSystem.normalize(right);
    const out: TimeInterval[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const x = a[i] as TimeInterval;
      const y = b[j] as TimeInterval;
      const start = x.startMs > y.startMs ? x.startMs : y.startMs;
      const end = x.endMs < y.endMs ? x.endMs : y.endMs;
      if (start < end) out.push(TimeInterval.of(start, end));
      if (x.endMs < y.endMs) i++;
      else j++;
    }
    return asNormalized(out);
  },

  /** `a ∪ b` — a linear merge of the two sorted sets, O(n + m). */
  union(
    left: readonly TimeInterval[],
    right: readonly TimeInterval[],
  ): NormalizedIntervals {
    const a = IntervalSetSystem.normalize(left);
    const b = IntervalSetSystem.normalize(right);
    if (b.length === 0) return a;
    if (a.length === 0) return b;
    const out: TimeInterval[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      const fromA =
        j >= b.length ||
        (i < a.length &&
          (a[i] as TimeInterval).startMs <= (b[j] as TimeInterval).startMs);
      const next = (fromA ? a[i++] : b[j++]) as TimeInterval;
      const last = out[out.length - 1];
      if (last !== undefined && next.startMs <= last.endMs) {
        if (next.endMs > last.endMs) {
          out[out.length - 1] = TimeInterval.of(last.startMs, next.endMs);
        }
      } else {
        out.push(next);
      }
    }
    return asNormalized(out);
  },

  /** Clip to a bound, dropping whatever falls entirely outside it. */
  clip(xs: readonly TimeInterval[], bound: TimeInterval): NormalizedIntervals {
    return IntervalSetSystem.intersect(xs, [bound]);
  },

  /** Total minutes covered; overlaps are never counted twice. */
  totalMinutes(xs: readonly TimeInterval[]): number {
    const set = IntervalSetSystem.normalize(xs);
    let total = 0;
    for (let i = 0; i < set.length; i++) {
      total += TimeInterval.durationMinutes(set[i] as TimeInterval);
    }
    return total;
  },
} as const;
