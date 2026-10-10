/**
 * A `[startMinutes, endMinutes)` span of wall-clock minutes within one day —
 * `{ startMinutes: 540, endMinutes: 720 }` is 09:00–12:00. No date, no zone,
 * no instant: a roster, an opening hour, a client's "I'm free 08:00–12:00"
 * or an exception's closed hours is a claim about clock faces, and stays true
 * across a DST transition precisely because it has no date. It becomes an
 * instant only against a day row of the zone table
 * (`ZonedTimeSystem.instantOf`), which is the single place DST can bite.
 *
 * Within a day, `0 ≤ startMinutes < endMinutes ≤ 1440`; an overnight span is
 * two ranges on two days, so a range never belongs to two day documents.
 */
export type MinuteRange = {
  readonly startMinutes: number;
  readonly endMinutes: number;
};

export const MinuteRange = {
  of(startMinutes: number, endMinutes: number): MinuteRange {
    return { startMinutes, endMinutes };
  },

  /** Half-open, so `09:00–12:00` and `12:00–17:00` do not overlap. */
  overlaps(a: MinuteRange, b: MinuteRange): boolean {
    return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
  },

  durationMinutes(range: MinuteRange): number {
    return range.endMinutes - range.startMinutes;
  },

  /**
   * Sorted, with overlapping AND abutting spans merged, empties dropped.
   *
   * Abutting spans merge too — `08:00–12:00` and `12:00–15:00` are one
   * availability of `08:00–15:00`, and leaving them split would show a person
   * two rows describing one continuous morning. Pure integer arithmetic on
   * clock faces: no day, no zone, no DST.
   */
  normalize(ranges: readonly MinuteRange[]): readonly MinuteRange[] {
    const sorted: MinuteRange[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i] as MinuteRange;
      if (range.startMinutes < range.endMinutes) sorted.push(range);
    }
    sorted.sort(
      (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
    );
    const merged: MinuteRange[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[i] as MinuteRange;
      const last = merged[merged.length - 1];
      if (last !== undefined && next.startMinutes <= last.endMinutes) {
        if (next.endMinutes > last.endMinutes) {
          merged[merged.length - 1] = {
            startMinutes: last.startMinutes,
            endMinutes: next.endMinutes,
          };
        }
      } else {
        merged.push(next);
      }
    }
    return merged;
  },
} as const;
