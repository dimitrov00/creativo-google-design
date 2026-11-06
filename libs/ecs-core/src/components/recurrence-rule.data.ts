import { LocalDate, Result, Tag, Weekday } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { RecurrenceEnd, RecurrenceEndRule } from './recurrence-end-rule.data';
import {
  MonthlyAnchor,
  RecurrenceFrequency,
  RecurrencePattern,
  WeekOfMonth,
} from './recurrence-pattern.data';

const MAX_INTERVAL = 99;
const MAX_OCCURRENCES = 366;

const ISO_WEEK: readonly Weekday[] = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
  Weekday.Sat,
  Weekday.Sun,
];

/** A leap year, for judging a yearly date that exists only in leap years. */
const LEAP_YEAR = 2000;

/**
 * A RECURRENCE RULE — which days a thing repeats on, and when it stops: the
 * part of iCalendar's RRULE (RFC 5545) Calendar, Google Calendar and Outlook
 * put in front of people (`recurrence-rule.ts:16-68`). Every day, a weekday
 * set, every month on a date or on «the fourth Thursday», every year; every
 * `recurrenceInterval`-th period; until a day or for N times.
 *
 * Flat (Law 6): the intersection of its pattern slice, the interval and its
 * end slice, so every field sits at the root and both discriminators
 * (`recurrenceFrequency`, `recurrenceEnd`) narrow independently.
 *
 * Explicit, never implied: every pattern names its days, so two rules are
 * equal exactly when they select the same days (weekdays are kept unique and
 * in ISO order). Days that do not exist are SKIPPED, never moved — «monthly on
 * the 31st» has no April. There is deliberately no «never»: a block series is
 * WRITTEN day by day, so a series materialises at most
 * {@link RecurrenceRule.MAX_OCCURRENCES} days. The walk itself is
 * `RecurrenceSystem.occurrences`; a series is not stored (§9 D16(b)).
 */
export type RecurrenceRule = RecurrencePattern & {
  /** Every `recurrenceInterval`-th period — «every 2 weeks»; `1…MAX_INTERVAL`. */
  readonly recurrenceInterval: number;
} & RecurrenceEndRule;

function isIsoWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/** The pattern made canonical, or the reason it cannot occur. */
function normalize(
  pattern: RecurrencePattern,
): Result<RecurrencePattern, SchedulingError> {
  switch (pattern.recurrenceFrequency) {
    case RecurrenceFrequency.Daily:
      return Result.ok(RecurrencePattern.daily());
    case RecurrenceFrequency.Weekly: {
      const weekdays: Weekday[] = [];
      for (let i = 0; i < ISO_WEEK.length; i++) {
        const weekday = ISO_WEEK[i] as Weekday;
        if (pattern.recurrenceWeekdays.includes(weekday))
          weekdays.push(weekday);
      }
      return weekdays.length === 0
        ? Result.err(SchedulingError.recurrenceNoWeekdays())
        : Result.ok(RecurrencePattern.weekly(weekdays));
    }
    case RecurrenceFrequency.Monthly: {
      if (pattern.monthlyAnchor === MonthlyAnchor.Date) {
        const date = pattern.monthlyDate;
        return Number.isInteger(date) && date >= 1 && date <= 31
          ? Result.ok(RecurrencePattern.monthlyByDate(date))
          : Result.err(SchedulingError.recurrenceInvalidDay(null, date));
      }
      return Tag.has(WeekOfMonth, pattern.monthlyWeek) &&
        isIsoWeekday(pattern.monthlyWeekday)
        ? Result.ok(
            RecurrencePattern.monthlyByWeekday(
              pattern.monthlyWeek,
              pattern.monthlyWeekday,
            ),
          )
        : Result.err(
            SchedulingError.recurrenceInvalidDay(null, pattern.monthlyWeek),
          );
    }
    case RecurrenceFrequency.Yearly: {
      const month = pattern.yearlyMonth;
      const date = pattern.yearlyDate;
      // Judged against a LEAP year (2000): 29 February is a real, if
      // quadrennial, anniversary; 30 February is not a day at all.
      const real =
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        Number.isInteger(date) &&
        date >= 1 &&
        date <= LocalDate.daysInMonth(LEAP_YEAR, month);
      return real
        ? Result.ok(RecurrencePattern.yearly(month, date))
        : Result.err(SchedulingError.recurrenceInvalidDay(month, date));
    }
  }
}

export const RecurrenceRule = {
  /** Every 1…99 periods. Apple's wheel stops at 999; a shop's has no use past 99. */
  MAX_INTERVAL,
  /** The most days one series may write — a year of them. */
  MAX_OCCURRENCES,

  /**
   * The edge guard and the canonicaliser: an interval of `1…MAX_INTERVAL`
   * (`SCHEDULING_RECURRENCE_INVALID_INTERVAL`), a count of
   * `1…MAX_OCCURRENCES` (`SCHEDULING_RECURRENCE_INVALID_COUNT`), and a
   * pattern that can occur — at least one weekday
   * (`SCHEDULING_RECURRENCE_NO_WEEKDAYS`), a real day
   * (`SCHEDULING_RECURRENCE_INVALID_DAY`). Weekdays come back unique and in
   * ISO order.
   */
  create(
    pattern: RecurrencePattern,
    interval: number,
    end: RecurrenceEndRule,
  ): Result<RecurrenceRule, SchedulingError> {
    if (
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > MAX_INTERVAL
    ) {
      return Result.err(
        SchedulingError.recurrenceInvalidInterval(interval, MAX_INTERVAL),
      );
    }
    if (
      end.recurrenceEnd === RecurrenceEnd.Count &&
      (!Number.isInteger(end.occurrenceCount) ||
        end.occurrenceCount < 1 ||
        end.occurrenceCount > MAX_OCCURRENCES)
    ) {
      return Result.err(
        SchedulingError.recurrenceInvalidCount(
          end.occurrenceCount,
          MAX_OCCURRENCES,
        ),
      );
    }
    const normalized = normalize(pattern);
    if (!normalized.ok) return normalized;
    return Result.ok(
      RecurrenceRule.of(
        normalized.value,
        interval,
        RecurrenceEndRule.sliceOf(end),
      ),
    );
  },

  /**
   * The three slices as one flat rule, WITHOUT the checks of {@link create}
   * — for a pattern read off a real day or a rule rebuilt from a valid one
   * (the start-following of `RecurrenceSystem`).
   */
  of(
    pattern: RecurrencePattern,
    recurrenceInterval: number,
    end: RecurrenceEndRule,
  ): RecurrenceRule {
    return { ...pattern, recurrenceInterval, ...end };
  },

  /** The rule's pattern slice, as a fresh struct. */
  patternOf(rule: RecurrenceRule): RecurrencePattern {
    switch (rule.recurrenceFrequency) {
      case RecurrenceFrequency.Daily:
        return RecurrencePattern.daily();
      case RecurrenceFrequency.Weekly:
        return RecurrencePattern.weekly(rule.recurrenceWeekdays);
      case RecurrenceFrequency.Monthly:
        return rule.monthlyAnchor === MonthlyAnchor.Date
          ? RecurrencePattern.monthlyByDate(rule.monthlyDate)
          : RecurrencePattern.monthlyByWeekday(
              rule.monthlyWeek,
              rule.monthlyWeekday,
            );
      case RecurrenceFrequency.Yearly:
        return RecurrencePattern.yearly(rule.yearlyMonth, rule.yearlyDate);
    }
  },

  frequency(rule: RecurrenceRule): RecurrenceFrequency {
    return rule.recurrenceFrequency;
  },

  /** Same days, same interval, same end. */
  equals(a: RecurrenceRule, b: RecurrenceRule | null): boolean {
    return (
      b !== null &&
      a.recurrenceInterval === b.recurrenceInterval &&
      RecurrencePattern.equals(a, b) &&
      RecurrenceEndRule.equals(a, b)
    );
  },
} as const;
