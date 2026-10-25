import { MinuteRange, NormalizedRanges } from '@core/components';
import { MinuteCount, EndMinute, MinuteOfDay } from '@core/primitives';

/**
 * The canonical form — the brand's one constructor,
 * `NormalizedRanges.normalize`. Every sweep below builds its output
 * canonical by construction (sorted, disjoint, non-touching, non-empty), so
 * handing it through here costs one linear check and returns the same array.
 */
const normalizeRanges = NormalizedRanges.normalize;

function subtractRanges(
  base: readonly MinuteRange[],
  cut: readonly MinuteRange[],
): NormalizedRanges {
  const windows = normalizeRanges(base);
  const cuts = normalizeRanges(cut);
  if (cuts.length === 0) return windows;
  const out: MinuteRange[] = [];
  let j = 0;
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i] as MinuteRange;
    // Cuts ending at or before this window cannot touch any later window.
    while (
      j < cuts.length &&
      (cuts[j] as MinuteRange).endMinutes <= window.startMinutes
    ) {
      j++;
    }
    let cursor = window.startMinutes;
    let consumed = false;
    for (let k = j; k < cuts.length; k++) {
      const taken = cuts[k] as MinuteRange;
      if (taken.startMinutes >= window.endMinutes) break;
      if (taken.startMinutes > cursor) {
        // `taken.startMinutes > cursor >= 0`, so it is a valid exclusive end.
        out.push(
          MinuteRange.of(cursor, EndMinute.ofLaterStart(taken.startMinutes)),
        );
      }
      // Cuts are disjoint and sorted, and those ending at or before the
      // window were skipped, so every cut reached here ends past `cursor`.
      if (taken.endMinutes >= window.endMinutes) {
        consumed = true;
        break;
      }
      // `taken.endMinutes < window.endMinutes <= 1440`: a minute of the day.
      cursor = MinuteOfDay.ofOpenEnd(taken.endMinutes);
    }
    // Not consumed: `cursor` is the window's start or a cut's end inside it.
    if (!consumed) out.push(MinuteRange.of(cursor, window.endMinutes));
  }
  return normalizeRanges(out);
}

function intersectRanges(
  left: readonly MinuteRange[],
  right: readonly MinuteRange[],
): NormalizedRanges {
  const a = normalizeRanges(left);
  const b = normalizeRanges(right);
  const out: MinuteRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as MinuteRange;
    const y = b[j] as MinuteRange;
    const start =
      x.startMinutes > y.startMinutes ? x.startMinutes : y.startMinutes;
    const end = x.endMinutes < y.endMinutes ? x.endMinutes : y.endMinutes;
    if (start < end) out.push(MinuteRange.of(start, end));
    if (x.endMinutes < y.endMinutes) i++;
    else j++;
  }
  return normalizeRanges(out);
}

function unionRanges(
  left: readonly MinuteRange[],
  right: readonly MinuteRange[],
): NormalizedRanges {
  const a = normalizeRanges(left);
  const b = normalizeRanges(right);
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out: MinuteRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const fromA =
      j >= b.length ||
      (i < a.length &&
        (a[i] as MinuteRange).startMinutes <=
          (b[j] as MinuteRange).startMinutes);
    const next = (fromA ? a[i++] : b[j++]) as MinuteRange;
    const last = out[out.length - 1];
    if (last !== undefined && next.startMinutes <= last.endMinutes) {
      if (next.endMinutes > last.endMinutes) {
        out[out.length - 1] = MinuteRange.of(
          last.startMinutes,
          next.endMinutes,
        );
      }
    } else {
      out.push(next);
    }
  }
  return normalizeRanges(out);
}

function totalRangeMinutes(xs: readonly MinuteRange[]): MinuteCount {
  const set = normalizeRanges(xs);
  let total = MinuteCount.ZERO;
  for (let i = 0; i < set.length; i++) {
    const range = set[i] as MinuteRange;
    total = MinuteCount.add(
      total,
      MinuteCount.span(range.startMinutes, range.endMinutes),
    );
  }
  return total;
}

function clip(
  xs: readonly MinuteRange[],
  bound: MinuteRange,
): NormalizedRanges {
  return intersectRanges(xs, [bound]);
}

function hull(xs: readonly MinuteRange[]): MinuteRange | null {
  const first = xs[0];
  if (first === undefined) return null;
  let start = first.startMinutes;
  let end = first.endMinutes;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i] as MinuteRange;
    if (x.startMinutes < start) start = x.startMinutes;
    if (x.endMinutes > end) end = x.endMinutes;
  }
  return MinuteRange.of(start, end);
}

/**
 * Set algebra over half-open `MinuteRange`s of ONE shop day — the arithmetic
 * availability is built from (working windows minus busy blocks, intersected
 * with policy). Local integers only (Law 7.3): DST cannot enter a loop.
 *
 * Inputs are read, never written. Each operation first brings its inputs to
 * canonical form: an input that already is one (every output of this
 * system) is used as-is after one linear check — no copy, no sort — so a
 * caller that keeps its sets normalized pays O(n) per operation; anything
 * else is copied, sorted once and merged.
 *
 * Touching runs MERGE (`[540,600)` + `[600,660)` → `[540,660)`): leaving them
 * split would reject a service that fits the union because it fits neither
 * half. A cut that merely touches a window consumes nothing (half-open).
 */
export const IntervalSetSystem = {
  /** Sorted, non-overlapping, non-touching; empty and inverted ranges dropped. Idempotent. */
  normalize: normalizeRanges,
  /** `base − cut` — one merge-style pass over both sorted sets: O(n + m). */
  subtract: subtractRanges,
  /** `a ∩ b` — a two-pointer sweep, O(n + m). Touching runs share nothing. */
  intersect: intersectRanges,
  /** `a ∪ b` — a linear merge of the two sorted sets, O(n + m). */
  union: unionRanges,
  /** Clip to a bound, dropping whatever falls entirely outside it. */
  clip,
  /** Total minutes covered; overlaps are never counted twice. */
  totalMinutes: totalRangeMinutes,
  /**
   * The outer edges of a set — the earliest start and the latest end
   * (`staff-dashboard.ts`' roster extents: where a chair's frame opens and
   * closes); `null` for none, and each caller answers that with its own
   * fallback. Unlike every operation above it reads the ranges AS GIVEN —
   * nothing is normalized or dropped, so an empty or inverted range still
   * stretches the hull with its own edges, exactly as `Math.min` over the
   * starts and `Math.max` over the ends. One linear pass, no sort.
   */
  hull,
} as const;
