/**
 * A half-open interval of epoch milliseconds, `[startMs, endMs)`.
 *
 * **Integers, not wall clocks.** Availability is set arithmetic — subtract
 * busy from working, intersect with policy, slide a duration through what
 * remains. On instants `10:00+03:00` and `10:00+02:00` are simply different
 * integers, so DST never enters an inner loop; the one conversion from a wall
 * clock happens once, in `ZonedTimeSystem`, at the boundary.
 *
 * **Half-open is load-bearing.** `[10:00, 10:45)` and `[10:45, 11:15)` do not
 * overlap, which lets one barber take a party's second seat the instant the
 * first ends. A closed interval would make every back-to-back booking a
 * conflict.
 *
 * A non-empty interval has `startMs < endMs`; the set operations of
 * `IntervalSetSystem` drop empty ones rather than propagate them.
 */
export type TimeInterval = { readonly startMs: number; readonly endMs: number };

export const TimeInterval = {
  of(startMs: number, endMs: number): TimeInterval {
    return { startMs, endMs };
  },

  overlaps(a: TimeInterval, b: TimeInterval): boolean {
    return a.startMs < b.endMs && b.startMs < a.endMs;
  },

  durationMinutes(interval: TimeInterval): number {
    return (interval.endMs - interval.startMs) / 60_000;
  },

  /** `inner` lies wholly inside `outer` (touching edges included). */
  contains(outer: TimeInterval, inner: TimeInterval): boolean {
    return outer.startMs <= inner.startMs && inner.endMs <= outer.endMs;
  },

  /**
   * Grow outward by the given minutes — how a buffer is applied.
   *
   * Padding goes on the BUSY interval, never on the candidate: pad both and a
   * uniform turnaround produces twice the intended gap
   * (`docs/design-research/availability-and-statistics-design.md` §9a R3).
   */
  pad(
    interval: TimeInterval,
    beforeMinutes: number,
    afterMinutes: number,
  ): TimeInterval {
    return {
      startMs: interval.startMs - beforeMinutes * 60_000,
      endMs: interval.endMs + afterMinutes * 60_000,
    };
  },

  equals(a: TimeInterval, b: TimeInterval): boolean {
    return a.startMs === b.startMs && a.endMs === b.endMs;
  },
} as const;
