import { MinuteRange } from './minute-range.data';

/**
 * A day's departure from the roster's breaks — a slice of every
 * `ScheduleException`, at its root (Law 6). `null`: the roster's breaks for
 * the weekday stand. A list: THIS day's breaks instead — the lunch moved
 * («Само този ден»), or `[]`, no break that day (owner, 2026-11-06: "no
 * lunch breaks for some specific days … removed day by day"). It is the
 * public effect, like the ranges beside it: geometry, never a reason.
 */
export type DayBreaks = {
  readonly dayBreakRanges: readonly MinuteRange[] | null;
};

const ROSTER: DayBreaks = { dayBreakRanges: null };

export const DayBreaks = {
  /** The roster's breaks stand. */
  roster(): DayBreaks {
    return ROSTER;
  },

  /** This day's breaks instead of the roster's — normalized; `[]` is none. */
  of(ranges: readonly MinuteRange[]): DayBreaks {
    return { dayBreakRanges: MinuteRange.normalize(ranges) };
  },
} as const;
