import type { EndMinute, MinuteOfDay, Weekday } from '@core/primitives';
import { MinuteRange } from './minute-range.data';

/**
 * A chair's standing break on one weekday — its lunch — on the shop's wall
 * clock: an element of `ScheduleVersion.breaks` (owner, 2026-11-06: "a lunch
 * break is a recurring blocker … it has to be very DOD"). The roster holds
 * the weekly PATTERN, so a break costs no document per day: every reader
 * already loads the roster and subtracts the weekday's breaks from the
 * worked time it builds (`RosterSystem`). A day that departs from it — the
 * lunch moved or skipped that one day — says so on its own exception
 * document (`DayBreaks`). A break over hours nobody works subtracts nothing.
 */
export type RosterBreak = {
  readonly weekday: Weekday;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

export const RosterBreak = {
  of(weekday: Weekday, range: MinuteRange): RosterBreak {
    return {
      weekday,
      startMinutes: range.startMinutes,
      endMinutes: range.endMinutes,
    };
  },

  /** Week order: weekday, then start. */
  compare(a: RosterBreak, b: RosterBreak): number {
    return (
      a.weekday - b.weekday ||
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes
    );
  },

  /** One weekday's breaks as minute ranges, normalized (sorted, merged). */
  rangesOn(
    breaks: readonly RosterBreak[],
    weekday: Weekday,
  ): readonly MinuteRange[] {
    const ranges: MinuteRange[] = [];
    for (let i = 0; i < breaks.length; i++) {
      const entry = breaks[i] as RosterBreak;
      if (entry.weekday === weekday) {
        ranges.push(MinuteRange.of(entry.startMinutes, entry.endMinutes));
      }
    }
    return MinuteRange.normalize(ranges);
  },
} as const;
