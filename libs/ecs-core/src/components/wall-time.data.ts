import type { LocalDate, MinuteOfDay } from '@core/primitives';

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

  /**
   * The point as the `datetime-local` WIRE text — `2026-03-29T03:30`: the
   * shop day, a `T`, and the minute's zero-padded 24-hour `HH:MM`. A pure
   * TEXT join (no zone, no instant — not a zone engine): the value a native
   * `<input type="datetime-local">` holds, and the `wallClock` param a
   * `DST_GAP_INVALID_TIME` refusal names the refused time by. A struct
   * carrying `localDate` and `minute` (the refusal itself) passes straight
   * in. Formatting for a READER stays the UI's (`@creativo/ui/wall-clock`).
   */
  toLocalIso(time: WallTime): string {
    const hours = String(Math.floor(time.minute / 60)).padStart(2, '0');
    const minutes = String(time.minute % 60).padStart(2, '0');
    return `${time.localDate}T${hours}:${minutes}`;
  },
} as const;
