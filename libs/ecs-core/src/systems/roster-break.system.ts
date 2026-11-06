import {
  type BarberId,
  type LocalDate,
  Result,
  Weekday,
} from '@core/primitives';

/** Every day of the week, Monday first — a daily repeat's weekdays. */
const EVERY_WEEKDAY: readonly Weekday[] = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
  Weekday.Sat,
  Weekday.Sun,
];
import { SchedulingError } from '@core/errors';
import {
  MinuteRange,
  RecurrenceFrequency,
  type RecurrenceRule,
  RosterBreak,
  ScheduleVersion,
} from '@core/components';
import type { BarberSchedule } from '@core/entities';

/**
 * A change of a chair's standing breaks «from this day on» — what
 * `amendRosterBreaks` carries: on each of `weekdays`, the break `before`
 * (matched on its edges; `null` adds) becomes `after` (`null` removes).
 * Creating a weekday lunch is `before: null`; skipping it from a day on is
 * `after: null`; a drag is both.
 */
export type RosterBreakChange = {
  readonly fromLocalDate: LocalDate;
  readonly weekdays: readonly Weekday[];
  readonly before: MinuteRange | null;
  readonly after: MinuteRange | null;
};

function sameEdges(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
}

/**
 * RosterBreakSystem — the standing breaks of a chair's roster, revised
 * (owner, 2026-11-06: a lunch is part of the weekly pattern, never a
 * document per day). The revision is ONE roster write: the versions from
 * the change's day on carry the new breaks (`ScheduleVersion.reviseFrom`),
 * every earlier day keeps what it was worked under.
 */
export const RosterBreakSystem = {
  /**
   * The breaks with `change` applied on its weekdays: `before` dropped,
   * `after` added, each weekday's breaks merged where they touch; sorted in
   * week order. Other weekdays are untouched.
   */
  revise(
    breaks: readonly RosterBreak[],
    change: Pick<RosterBreakChange, 'weekdays' | 'before' | 'after'>,
  ): readonly RosterBreak[] {
    const next: RosterBreak[] = [];
    for (let i = 0; i < breaks.length; i++) {
      const entry = breaks[i] as RosterBreak;
      if (!change.weekdays.includes(entry.weekday)) next.push(entry);
    }
    for (let i = 0; i < change.weekdays.length; i++) {
      const weekday = change.weekdays[i] as Weekday;
      const own: MinuteRange[] = [];
      const ranges = RosterBreak.rangesOn(breaks, weekday);
      for (let k = 0; k < ranges.length; k++) {
        const range = ranges[k] as MinuteRange;
        if (change.before === null || !sameEdges(range, change.before)) {
          own.push(range);
        }
      }
      if (change.after !== null) own.push(change.after);
      const merged = MinuteRange.normalize(own);
      for (let k = 0; k < merged.length; k++) {
        next.push(RosterBreak.of(weekday, merged[k] as MinuteRange));
      }
    }
    return next.sort(RosterBreak.compare);
  },

  /**
   * The weekdays a repeat with no end stands on as a roster break — every
   * day, or the weekly rule's weekdays, every week — or `null` when the
   * rule is not a weekly pattern (every 2 weeks, monthly, yearly): the
   * roster is a week, so only a weekly repeat can live in it.
   */
  standingWeekdays(rule: RecurrenceRule): readonly Weekday[] | null {
    if (rule.recurrenceInterval !== 1) return null;
    switch (rule.recurrenceFrequency) {
      case RecurrenceFrequency.Daily:
        return EVERY_WEEKDAY;
      case RecurrenceFrequency.Weekly:
        return rule.recurrenceWeekdays;
      case RecurrenceFrequency.Monthly:
      case RecurrenceFrequency.Yearly:
        return null;
    }
  },

  /**
   * The kept break a drawn one stands for — the first of `dayBreaks` it
   * overlaps (a drawn break is clipped to worked time; the kept one is
   * whole), or `null` when none does.
   */
  wholeOf(
    dayBreaks: readonly MinuteRange[],
    drawn: MinuteRange,
  ): MinuteRange | null {
    for (let i = 0; i < dayBreaks.length; i++) {
      const range = dayBreaks[i] as MinuteRange;
      if (MinuteRange.overlaps(range, drawn)) return range;
    }
    return null;
  },

  /**
   * One day's breaks with `from` (matched on its edges) replaced by `to` —
   * `null` removes it — normalized: what «Само този ден» writes as the
   * day's own breaks (`[]`: none that day).
   */
  dayWith(
    dayBreaks: readonly MinuteRange[],
    from: MinuteRange,
    to: MinuteRange | null,
  ): readonly MinuteRange[] {
    const kept: MinuteRange[] = [];
    for (let i = 0; i < dayBreaks.length; i++) {
      const range = dayBreaks[i] as MinuteRange;
      if (!sameEdges(range, from)) kept.push(range);
    }
    if (to !== null) kept.push(to);
    return MinuteRange.normalize(kept);
  },

  /**
   * The roster's history with `change` applied from its day on — refused
   * from a day before the shop's `today` (`SCHEDULING_ROSTER_BREAK_IN_PAST`:
   * the past is the record) and for a chair with no roster
   * (`SCHEDULING_ROSTER_MISSING`).
   */
  amend(
    schedule: BarberSchedule | null,
    barberId: BarberId,
    change: RosterBreakChange,
    today: LocalDate,
  ): Result<readonly ScheduleVersion[], SchedulingError> {
    if (change.fromLocalDate < today) {
      return Result.err(
        SchedulingError.rosterBreakInPast(change.fromLocalDate, today),
      );
    }
    if (schedule === null || schedule.versions.length === 0) {
      return Result.err(SchedulingError.rosterMissing(barberId));
    }
    const history = ScheduleVersion.history(schedule.versions);
    if (!history.ok) return history;
    return Result.ok(
      ScheduleVersion.reviseFrom(history.value, change.fromLocalDate, (v) => ({
        ...v,
        breaks: RosterBreakSystem.revise(v.breaks, change),
      })),
    );
  },
} as const;
