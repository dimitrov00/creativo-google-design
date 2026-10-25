import type { Brand } from '@core/primitives';
import { MinuteRange } from './minute-range.data';

/**
 * A canonical range set of ONE shop day: sorted by `startMinutes`,
 * non-empty, pairwise disjoint AND non-touching (touching runs are merged).
 * Every operation of `IntervalSetSystem` returns one; the brand flags it so
 * a hot caller can hold its sets normalized and hand them back in (moved
 * from `interval-set.system.ts` with its one constructor, pass D: the cast
 * lives here, in the brand's own file).
 */
export type NormalizedRanges = Brand<
  readonly MinuteRange[],
  'NormalizedRanges'
>;

function byStart(a: MinuteRange, b: MinuteRange): number {
  return a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes;
}

export const NormalizedRanges = {
  /**
   * One linear pass: is `xs` canonical already — every range non-empty,
   * each starting strictly after the previous one ends? No allocation.
   */
  isNormalized(xs: readonly MinuteRange[]): boolean {
    let lastEnd = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as MinuteRange;
      if (!(x.startMinutes < x.endMinutes) || x.startMinutes <= lastEnd) {
        return false;
      }
      lastEnd = x.endMinutes;
    }
    return true;
  },

  /**
   * The canonical form of `xs` — the brand's ONE constructor (and its one
   * cast site): sorted, non-overlapping, non-touching; empty and inverted
   * ranges dropped. Idempotent. An input that already is canonical
   * ({@link NormalizedRanges.isNormalized}) comes back AS IS — the same
   * array, no copy, no sort — so a caller that keeps its sets normalized
   * pays one linear check; anything else is copied, sorted once and merged.
   * The input is never written.
   */
  normalize(xs: readonly MinuteRange[]): NormalizedRanges {
    if (NormalizedRanges.isNormalized(xs)) return xs as NormalizedRanges;
    const sorted: MinuteRange[] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as MinuteRange;
      if (x.startMinutes < x.endMinutes) sorted.push(x);
    }
    sorted.sort(byStart);
    const merged: MinuteRange[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[i] as MinuteRange;
      const last = merged[merged.length - 1];
      if (last !== undefined && next.startMinutes <= last.endMinutes) {
        if (next.endMinutes > last.endMinutes) {
          merged[merged.length - 1] = MinuteRange.of(
            last.startMinutes,
            next.endMinutes,
          );
        }
      } else {
        merged.push(next);
      }
    }
    return merged as readonly MinuteRange[] as NormalizedRanges;
  },
} as const;
