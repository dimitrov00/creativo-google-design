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
 * Flatten pass: ecs-core's interval algebra is minute ranges of ONE shop day
 * now (`MinuteRange` + `IntervalSetSystem`, Law 7.3) and its epoch-ms
 * `TimeInterval` is gone, so this legacy shape keeps its own epoch-ms
 * algebra — the same algorithms the ecs-core `TimeInterval` overloads ran,
 * operation for operation — until the legacy domain dies in the
 * booking-core flip.
 */
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

function byStart(a: Interval, b: Interval): number {
  return a.startMs - b.startMs || a.endMs - b.endMs;
}

/** Sorted, every interval non-empty, none overlapping or touching the next. */
function isNormalized(xs: readonly Interval[]): boolean {
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as Interval;
    if (!(x.startMs < x.endMs) || x.startMs <= lastEnd) return false;
    lastEnd = x.endMs;
  }
  return true;
}

/**
 * The canonical form: an input that already is one is returned as-is after
 * one linear check — no copy, no sort; anything else is copied, sorted once
 * and merged.
 */
function normalize(xs: readonly Interval[]): readonly Interval[] {
  if (isNormalized(xs)) return xs;
  const sorted: Interval[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as Interval;
    if (x.startMs < x.endMs) sorted.push(x);
  }
  sorted.sort(byStart);
  const merged: Interval[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i] as Interval;
    const last = merged[merged.length - 1];
    if (last !== undefined && next.startMs <= last.endMs) {
      if (next.endMs > last.endMs) {
        merged[merged.length - 1] = Interval.of(last.startMs, next.endMs);
      }
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function subtract(
  base: readonly Interval[],
  cut: readonly Interval[],
): readonly Interval[] {
  const windows = normalize(base);
  const cuts = normalize(cut);
  if (cuts.length === 0) return windows;
  const out: Interval[] = [];
  let j = 0;
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i] as Interval;
    while (j < cuts.length && (cuts[j] as Interval).endMs <= window.startMs) {
      j++;
    }
    let cursor = window.startMs;
    for (let k = j; k < cuts.length; k++) {
      const taken = cuts[k] as Interval;
      if (taken.startMs >= window.endMs) break;
      if (taken.startMs > cursor) out.push(Interval.of(cursor, taken.startMs));
      cursor = taken.endMs;
      if (cursor >= window.endMs) break;
    }
    if (cursor < window.endMs) out.push(Interval.of(cursor, window.endMs));
  }
  return out;
}

function intersect(
  left: readonly Interval[],
  right: readonly Interval[],
): readonly Interval[] {
  const a = normalize(left);
  const b = normalize(right);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as Interval;
    const y = b[j] as Interval;
    const start = x.startMs > y.startMs ? x.startMs : y.startMs;
    const end = x.endMs < y.endMs ? x.endMs : y.endMs;
    if (start < end) out.push(Interval.of(start, end));
    if (x.endMs < y.endMs) i++;
    else j++;
  }
  return out;
}

function union(
  left: readonly Interval[],
  right: readonly Interval[],
): readonly Interval[] {
  const a = normalize(left);
  const b = normalize(right);
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const fromA =
      j >= b.length ||
      (i < a.length &&
        (a[i] as Interval).startMs <= (b[j] as Interval).startMs);
    const next = (fromA ? a[i++] : b[j++]) as Interval;
    const last = out[out.length - 1];
    if (last !== undefined && next.startMs <= last.endMs) {
      if (next.endMs > last.endMs) {
        out[out.length - 1] = Interval.of(last.startMs, next.endMs);
      }
    } else {
      out.push(next);
    }
  }
  return out;
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

  /** `inner` lies wholly inside `outer` (touching edges included). */
  contains(outer: Interval, inner: Interval): boolean {
    return outer.startMs <= inner.startMs && inner.endMs <= outer.endMs;
  },

  /**
   * Sorted, non-overlapping, non-touching — the canonical form every other
   * operation assumes and returns. Touching intervals are MERGED.
   */
  normalize,

  /** `base − cut` — the free time left after removing what is taken. */
  subtract,

  intersect,

  union,

  /**
   * Grow an interval outward by the given minutes — how a buffer is applied.
   * Padding goes on the BUSY interval, never on the candidate slot.
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
    return intersect(intervals, [bound]);
  },

  /** Total minutes covered. Normalizes first, so overlaps are never counted twice. */
  totalMinutes(intervals: readonly Interval[]): number {
    const set = normalize(intervals);
    let total = 0;
    for (let i = 0; i < set.length; i++) {
      total += Interval.durationMinutes(set[i] as Interval);
    }
    return total;
  },

  equals(a: Interval, b: Interval): boolean {
    return a.startMs === b.startMs && a.endMs === b.endMs;
  },
} as const;
