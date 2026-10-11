import type { LocalDate } from '../primitives/local-date.primitive';
import type { MinuteOfDay } from '../primitives/minute-of-day.primitive';

/**
 * A point on the shop's wall clock — the shop day and the minute from its
 * local midnight. What an instant reads as in the location's `timeZone`
 * (`ZonedTimeSystem.toLocal`), and what a placement check receives instead of
 * an instant (flatten-spec T6). No zone, no instant: DST cannot reach it.
 */
export type WallTime = {
  readonly localDate: LocalDate;
  readonly minute: MinuteOfDay;
};

export const WallTime = {
  of(localDate: LocalDate, minute: MinuteOfDay): WallTime {
    return { localDate, minute };
  },

  /**
   * Wall-clock order on the civil line: `(localDate, minute)` compared
   * lexicographically — `-1` when `a` comes first, `0` when equal, `1` after.
   */
  compare(a: WallTime, b: WallTime): -1 | 0 | 1 {
    if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
    return a.minute < b.minute ? -1 : a.minute > b.minute ? 1 : 0;
  },
} as const;
