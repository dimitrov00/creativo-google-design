import {
  MonthlyAnchor,
  RecurrenceEnd,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  WeekOfMonth,
} from '@core/components';
import { Result, type Weekday, LocalDate } from '@core/primitives';
import { SchedulingError } from '@core/errors';

/**
 * A SERIES — a rule bound to the shop day it starts on, and so to its days
 * (`recurrence-rule.ts:478-557`). In memory only (§9 D16(b): a series is not
 * stored; its days are written one exception per barber-day).
 *
 * - `startLocalDate` — the day the series was started from. It BOUNDS the
 *   series; it is not an occurrence by fiat (Outlook's reading, not RFC
 *   5545's): a Thursday nobody asked for is a Thursday no client can book.
 * - `localDates` — every day of the series, in order; never empty, never
 *   more than {@link RecurrenceRule.MAX_OCCURRENCES}.
 */
export type RecurrenceSeries = {
  readonly startLocalDate: LocalDate;
  readonly rule: RecurrenceRule;
  readonly localDates: readonly LocalDate[];
};

/**
 * Periods a monthly or yearly walk tries before giving up on a pattern that
 * cannot land (the 31st, every twelfth month, from a February) —
 * `recurrence-rule.ts:70`. Plain arithmetic: ten thousand steps cost
 * microseconds.
 */
const PERIOD_GUARD = 10_000;

/** The last day a four-digit year can name — where every walk stops. */
const LAST_EPOCH_DAY = LocalDate.epochDayOf(9999, 12, 31);

/** The ISO weekday of an epoch day — through the civil day, the one weekday rule. */
function weekdayOfEpochDay(epochDay: number): Weekday {
  return LocalDate.weekday(LocalDate.fromEpochDay(epochDay));
}

/** The `week`-th (or last) `weekday` of a month, as an epoch day. Always exists. */
function nthWeekdayOf(
  year: number,
  month: number,
  weekday: Weekday,
  week: WeekOfMonth,
): number {
  if (week === WeekOfMonth.Last) {
    const last = LocalDate.epochDayOf(
      year,
      month,
      LocalDate.daysInMonth(year, month),
    );
    return last - ((weekdayOfEpochDay(last) - weekday + 7) % 7);
  }
  const first = LocalDate.epochDayOf(year, month, 1);
  return (
    first + ((weekday - weekdayOfEpochDay(first) + 7) % 7) + (week - 1) * 7
  );
}

/** A pattern read off a real day — valid by construction, so no `Result`. */
function withPattern(
  rule: RecurrenceRule,
  pattern: RecurrencePattern,
): RecurrenceRule {
  return RecurrenceRule.of(
    pattern,
    rule.recurrenceInterval,
    RecurrenceRule.endOf(rule),
  );
}

/**
 * The walk (`recurrence-rule.ts:418-476`): every day of `rule` from `from`
 * on, in order, up to `until` (inclusive) and at most `limit` days — fewer
 * when the rule's own count stops first. Only days on or after `from` count;
 * `from` itself only if the rule selects it. Epoch-day integers throughout:
 * a day is always one step, and «every Tuesday» names the same Tuesday in
 * every zone.
 */
function walk(
  rule: RecurrenceRule,
  from: number,
  until: number,
  limit: number,
): readonly number[] {
  const wanted =
    rule.recurrenceEnd === RecurrenceEnd.Count
      ? Math.min(rule.occurrenceCount, limit)
      : limit;
  const days: number[] = [];
  if (wanted <= 0) return days;

  /** `true` once the walk is over — past the end, or enough days. */
  const take = (day: number): boolean => {
    if (day < from) return false;
    if (day > until) return true;
    days.push(day);
    return days.length >= wanted;
  };

  const step = rule.recurrenceInterval;
  switch (rule.recurrenceFrequency) {
    case RecurrenceFrequency.Daily: {
      let day = from;
      while (!take(day)) day += step;
      break;
    }
    case RecurrenceFrequency.Weekly: {
      const monday = from - (weekdayOfEpochDay(from) - 1);
      const weekdays = rule.recurrenceWeekdays;
      walking: for (let week = monday; week <= until; week += 7 * step) {
        for (let i = 0; i < weekdays.length; i++) {
          if (take(week + (weekdays[i] as Weekday) - 1)) break walking;
        }
      }
      break;
    }
    case RecurrenceFrequency.Monthly: {
      const origin = LocalDate.parts(LocalDate.fromEpochDay(from));
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const index = origin.month - 1 + period * step;
        const year = origin.year + Math.floor(index / 12);
        const month = (index % 12) + 1;
        if (LocalDate.epochDayOf(year, month, 1) > until) break;
        if (rule.monthlyAnchor === MonthlyAnchor.Date) {
          if (rule.monthlyDate > LocalDate.daysInMonth(year, month)) continue;
          if (take(LocalDate.epochDayOf(year, month, rule.monthlyDate))) break;
        } else if (
          take(nthWeekdayOf(year, month, rule.monthlyWeekday, rule.monthlyWeek))
        ) {
          break;
        }
      }
      break;
    }
    case RecurrenceFrequency.Yearly: {
      const origin = LocalDate.parts(LocalDate.fromEpochDay(from));
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const year = origin.year + period * step;
        if (LocalDate.epochDayOf(year, 1, 1) > until) break;
        if (rule.yearlyDate > LocalDate.daysInMonth(year, rule.yearlyMonth)) {
          continue;
        }
        if (take(LocalDate.epochDayOf(year, rule.yearlyMonth, rule.yearlyDate)))
          break;
      }
      break;
    }
  }
  return days;
}

/** The rule's own last day as an epoch day, capped at the last four-digit day. */
function endEpochDay(rule: RecurrenceRule): number {
  return rule.recurrenceEnd === RecurrenceEnd.Until
    ? Math.min(LocalDate.toEpochDay(rule.untilLocalDate), LAST_EPOCH_DAY)
    : LAST_EPOCH_DAY;
}

function toLocalDates(days: readonly number[]): readonly LocalDate[] {
  const dates: LocalDate[] = [];
  for (let i = 0; i < days.length; i++) {
    dates.push(LocalDate.fromEpochDay(days[i] as number));
  }
  return dates;
}

/**
 * Which shop days a recurrence rule selects — the walk, the presets and the
 * series limits of `recurrence-rule.ts:252-557`, over CIVIL days
 * (`LocalDate`). The rule itself (canonical weekdays, the interval and count
 * caps, equality) is the {@link RecurrenceRule} component.
 *
 * Civil arithmetic only (T8: multi-day spans are `LocalDate` arithmetic):
 * Howard Hinnant's `days_from_civil` / `civil_from_days`
 * (`LocalDate.epochDayOf` / `LocalDate.fromEpochDay`), the leap rule's month
 * lengths (`LocalDate.daysInMonth`) and the civil weekday
 * (`LocalDate.weekday`). A weekday is a property of the civil day, the same
 * in every zone, so no zone is needed — the series' days become instants
 * only where a write lifts them into the shop's zone.
 */
export const RecurrenceSystem = {
  /**
   * What a bare frequency means from `startLocalDate` — «every week» on the
   * start's weekday, «every month» on its date, «every year» on its day
   * (`recurrence-rule.ts:276-290`). Total: a pattern read off a real day is
   * always a real pattern.
   */
  patternFor(
    frequency: RecurrenceFrequency,
    startLocalDate: LocalDate,
  ): RecurrencePattern {
    const start = LocalDate.parts(startLocalDate);
    switch (frequency) {
      case RecurrenceFrequency.Daily:
        return RecurrencePattern.daily();
      case RecurrenceFrequency.Weekly:
        return RecurrencePattern.weekly([LocalDate.weekday(startLocalDate)]);
      case RecurrenceFrequency.Monthly:
        return RecurrencePattern.monthlyByDate(start.day);
      case RecurrenceFrequency.Yearly:
        return RecurrencePattern.yearly(start.month, start.day);
    }
  },

  /**
   * The monthly readings a start offers — Google's own list
   * (`recurrence-rule.ts:297-308`): «on the 24th», «on the fourth Thursday»,
   * and «on the last Thursday» when the start is in its month's last seven
   * days. A fifth weekday offers only «last».
   */
  monthlyDaysFor(
    startLocalDate: LocalDate,
  ): readonly RecurrencePattern.Monthly[] {
    const start = LocalDate.parts(startLocalDate);
    const weekday = LocalDate.weekday(startLocalDate);
    const week = Math.ceil(start.day / 7);
    const isLast =
      start.day + 7 > LocalDate.daysInMonth(start.year, start.month);
    const days: RecurrencePattern.Monthly[] = [
      RecurrencePattern.monthlyByDate(start.day),
    ];
    if (week <= 4) {
      days.push(
        RecurrencePattern.monthlyByWeekday(week as WeekOfMonth, weekday),
      );
    }
    if (isLast) {
      days.push(RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, weekday));
    }
    return days;
  },

  /**
   * THE START MOVED (`recurrence-rule.ts:332-375`): a pattern that was the
   * start's own follows it; one the user shaped stays put. «Weekly on
   * Thursday» from a Thursday becomes «weekly on Friday» when the start steps
   * to Friday, while «Monday and Wednesday» keeps its days. A monthly «last
   * Thursday» stays a LAST where the new start can be one. An unchanged rule
   * comes back as the SAME struct (identity), so a caller can tell.
   */
  followingStart(
    rule: RecurrenceRule,
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
  ): RecurrenceRule {
    switch (rule.recurrenceFrequency) {
      case RecurrenceFrequency.Daily:
        return rule;
      case RecurrenceFrequency.Weekly: {
        const own =
          rule.recurrenceWeekdays.length === 1 &&
          rule.recurrenceWeekdays[0] === LocalDate.weekday(fromLocalDate);
        return own
          ? withPattern(
              rule,
              RecurrenceSystem.patternFor(
                RecurrenceFrequency.Weekly,
                toLocalDate,
              ),
            )
          : rule;
      }
      case RecurrenceFrequency.Monthly: {
        const fromChoices = RecurrenceSystem.monthlyDaysFor(fromLocalDate);
        let own = false;
        for (let i = 0; i < fromChoices.length; i++) {
          if (
            RecurrencePattern.equals(
              fromChoices[i] as RecurrencePattern.Monthly,
              rule,
            )
          ) {
            own = true;
            break;
          }
        }
        if (!own) return rule;
        const choices = RecurrenceSystem.monthlyDaysFor(toLocalDate);
        let kept: RecurrencePattern.Monthly | null = null;
        if (rule.monthlyAnchor === MonthlyAnchor.Date) {
          kept = choices[0] ?? null;
        } else {
          const wantLast = rule.monthlyWeek === WeekOfMonth.Last;
          let anyWeekday: RecurrencePattern.Monthly | null = null;
          for (let i = 0; i < choices.length; i++) {
            const choice = choices[i] as RecurrencePattern.Monthly;
            if (choice.monthlyAnchor !== MonthlyAnchor.Weekday) continue;
            if (anyWeekday === null) anyWeekday = choice;
            if ((choice.monthlyWeek === WeekOfMonth.Last) === wantLast) {
              kept = choice;
              break;
            }
          }
          if (kept === null) kept = anyWeekday;
        }
        return kept === null ? rule : withPattern(rule, kept);
      }
      case RecurrenceFrequency.Yearly: {
        const from = LocalDate.parts(fromLocalDate);
        const own =
          rule.yearlyMonth === from.month && rule.yearlyDate === from.day;
        return own
          ? withPattern(
              rule,
              RecurrenceSystem.patternFor(
                RecurrenceFrequency.Yearly,
                toLocalDate,
              ),
            )
          : rule;
      }
    }
  },

  /**
   * The days `rule` selects from `fromLocalDate` through `toLocalDate` (both
   * inclusive), in order — bounded by `toLocalDate`, by the rule's own end
   * (its `untilLocalDate` or its `occurrenceCount`, counted from
   * `fromLocalDate`) AND by {@link RecurrenceRule.MAX_OCCURRENCES}, so no
   * call materialises more than a year of days. `[]` when nothing lands (or
   * `toLocalDate` precedes `fromLocalDate`).
   */
  occurrences(
    rule: RecurrenceRule,
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate,
  ): readonly LocalDate[] {
    const until = Math.min(
      endEpochDay(rule),
      LocalDate.toEpochDay(toLocalDate),
    );
    return toLocalDates(
      walk(
        rule,
        LocalDate.toEpochDay(fromLocalDate),
        until,
        RecurrenceRule.MAX_OCCURRENCES,
      ),
    );
  },

  /**
   * Bind `rule` to the day it starts on (`RecurrenceSeries.create`,
   * `recurrence-rule.ts:501-526`). The limits live here because only here
   * are they knowable, each a refusal rather than a silently truncated write:
   * an `untilLocalDate` before the start
   * (`SCHEDULING_RECURRENCE_ENDS_BEFORE_START`), more than
   * {@link RecurrenceRule.MAX_OCCURRENCES} days
   * (`SCHEDULING_RECURRENCE_TOO_LONG` — the walk looks one day past the cap
   * to know), and a rule that selects nothing before its end
   * (`SCHEDULING_RECURRENCE_NEVER_OCCURS`).
   */
  series(
    startLocalDate: LocalDate,
    rule: RecurrenceRule,
  ): Result<RecurrenceSeries, SchedulingError> {
    if (
      rule.recurrenceEnd === RecurrenceEnd.Until &&
      rule.untilLocalDate < startLocalDate
    ) {
      return Result.err(
        SchedulingError.recurrenceEndsBeforeStart(
          startLocalDate,
          rule.untilLocalDate,
        ),
      );
    }
    const found = walk(
      rule,
      LocalDate.toEpochDay(startLocalDate),
      endEpochDay(rule),
      RecurrenceRule.MAX_OCCURRENCES + 1,
    );
    if (found.length > RecurrenceRule.MAX_OCCURRENCES) {
      return Result.err(
        SchedulingError.recurrenceTooLong(RecurrenceRule.MAX_OCCURRENCES),
      );
    }
    if (found.length === 0) {
      return Result.err(SchedulingError.recurrenceNeverOccurs(startLocalDate));
    }
    return Result.ok({
      startLocalDate,
      rule,
      localDates: toLocalDates(found),
    });
  },

  /** Is the day the series was started from one of its days (its first)? */
  startsOnStart(series: RecurrenceSeries): boolean {
    return series.localDates[0] === series.startLocalDate;
  },
} as const;
