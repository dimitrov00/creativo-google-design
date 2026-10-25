import {
  MinuteCount,
  EndMinute,
  MinuteOfDay,
  type StoredFields,
} from '@core/primitives';

/**
 * A `[startMinutes, endMinutes)` span of the shop's wall clock within one
 * day — `{ startMinutes: 540, endMinutes: 720 }` is 09:00–12:00. No date, no
 * zone, no instant: a roster, an opening hour, a client's "I'm free
 * 08:00–12:00", an exception's closed hours or a busy span on a KNOWN
 * `localDate` is a claim about clock faces, and stays true across a DST
 * transition precisely because it has no zone (Law 7.3: placement math is
 * local).
 *
 * `startMinutes` is a `MinuteOfDay` (`[0, 1440)`), `endMinutes` an exclusive
 * `EndMinute` (`(0, 1440]`, decision F-1); a non-empty range has
 * `startMinutes < endMinutes`. An overnight span is two ranges on two days.
 * Half-open is load-bearing: `[10:00, 10:45)` and `[10:45, 11:15)` do not
 * overlap, which lets one barber take a party's second seat the minute the
 * first ends.
 */
export type MinuteRange = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

export const MinuteRange = {
  of(startMinutes: MinuteOfDay, endMinutes: EndMinute): MinuteRange {
    return { startMinutes, endMinutes };
  },

  /**
   * The read-time check of a stored range (edge hardening D-1): the NAME of
   * the first field that is not well-formed — `startMinutes` (a
   * `MinuteOfDay`), `endMinutes` (an `EndMinute`), then `endMinutes` again
   * when the range is empty or inverted (`startMinutes < endMinutes`, what
   * every collision scan relies on) — or `null`. The one home of the minute
   * pair's check: `TimeCoordinate` and `MinuteBlock` compose it. No
   * allocation (the answer is a literal).
   */
  fieldFault(raw: StoredFields): string | null {
    const start = raw['startMinutes'];
    if (!MinuteOfDay.is(start)) return 'startMinutes';
    const end = raw['endMinutes'];
    if (!EndMinute.is(end)) return 'endMinutes';
    return start < end ? null : 'endMinutes';
  },

  /** Half-open, so `09:00–12:00` and `12:00–17:00` do not overlap. */
  overlaps(a: MinuteRange, b: MinuteRange): boolean {
    return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
  },

  /** The range's length in minutes (`endMinutes − startMinutes`). */
  durationMinutes(range: MinuteRange): MinuteCount {
    return MinuteCount.span(range.startMinutes, range.endMinutes);
  },

  /** `inner` lies wholly inside `outer` (touching edges included). */
  contains(outer: MinuteRange, inner: MinuteRange): boolean {
    return (
      outer.startMinutes <= inner.startMinutes &&
      inner.endMinutes <= outer.endMinutes
    );
  },

  /**
   * Grow outward by the given minutes — how a buffer is applied — clamped to
   * the day, `[0, 1440]` (a padded chair time never leaves its shop day, T7).
   *
   * Padding goes on the BUSY range, never on the candidate: pad both and a
   * uniform turnaround produces twice the intended gap
   * (`docs/design-research/availability-and-statistics-design.md` §9a R3).
   */
  pad(
    range: MinuteRange,
    before: MinuteCount,
    after: MinuteCount,
  ): MinuteRange {
    return {
      startMinutes: MinuteOfDay.minusClamped(range.startMinutes, before),
      endMinutes: EndMinute.plusClamped(range.endMinutes, after),
    };
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
