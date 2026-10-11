import { LocalDate } from '../primitives/local-date.primitive';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';
import { Weekday } from './weekday.data';

/**
 * How often a rule repeats — the ONLY source of these strings, named after
 * the field it types (`recurrenceFrequency`, N15; was `Frequency`).
 */
export const RecurrenceFrequency = {
  Daily: 'DAILY',
  Weekly: 'WEEKLY',
  Monthly: 'MONTHLY',
  Yearly: 'YEARLY',
} as const;
export type RecurrenceFrequency =
  (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];

/**
 * Which week of its month a day is in: the first … the fourth, or the LAST.
 * There is no fifth — a fifth weekday is always the last one, and «last» is
 * the reading that still means something in a four-week month. Numbers, not
 * tags: they are ordinals the walk computes with.
 */
export const WeekOfMonth = {
  First: 1,
  Second: 2,
  Third: 3,
  Fourth: 4,
  Last: -1,
} as const;
export type WeekOfMonth = (typeof WeekOfMonth)[keyof typeof WeekOfMonth];

/**
 * How a monthly rule finds its day — iCalendar's `BYMONTHDAY` or ordinal
 * `BYDAY`; named after the field it types (`monthlyAnchor`).
 */
export const MonthlyAnchor = {
  /** «on the 24th». */
  Date: 'DATE',
  /** «on the fourth Thursday», «on the last Thursday». */
  Weekday: 'WEEKDAY',
} as const;
export type MonthlyAnchor = (typeof MonthlyAnchor)[keyof typeof MonthlyAnchor];

/**
 * How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`; named
 * after the field it types (`recurrenceEnd`).
 */
export const RecurrenceEnd = {
  Until: 'UNTIL',
  Count: 'COUNT',
} as const;
export type RecurrenceEnd = (typeof RecurrenceEnd)[keyof typeof RecurrenceEnd];

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

const WEEKS_OF_MONTH: readonly number[] = Object.values(WeekOfMonth);

/** A leap year, for judging a yearly date that exists only in leap years. */
const LEAP_YEAR = 2000;

/**
 * WHICH days of a period a rule selects, per frequency — a flat variant
 * slice of {@link RecurrenceRule}; each variant carries only what it needs,
 * every variant field prefixed by its frequency or anchor
 * (`recurrenceWeekdays`, `monthlyDate`, `yearlyMonth`). Weekdays are kept
 * unique and in ISO order by {@link RecurrenceRule.create}.
 */
export type RecurrencePattern =
  | RecurrencePattern.Daily
  | RecurrencePattern.Weekly
  | RecurrencePattern.MonthlyByDate
  | RecurrencePattern.MonthlyByWeekday
  | RecurrencePattern.Yearly;

const DAILY: RecurrencePattern.Daily = {
  recurrenceFrequency: RecurrenceFrequency.Daily,
};

export const RecurrencePattern = {
  daily(): RecurrencePattern.Daily {
    return DAILY;
  },
  weekly(recurrenceWeekdays: readonly Weekday[]): RecurrencePattern.Weekly {
    return {
      recurrenceFrequency: RecurrenceFrequency.Weekly,
      recurrenceWeekdays,
    };
  },
  /** «every month on the 24th». */
  monthlyByDate(monthlyDate: number): RecurrencePattern.MonthlyByDate {
    return {
      recurrenceFrequency: RecurrenceFrequency.Monthly,
      monthlyAnchor: MonthlyAnchor.Date,
      monthlyDate,
    };
  },
  /** «every month on the fourth (or last) Thursday». */
  monthlyByWeekday(
    monthlyWeek: WeekOfMonth,
    monthlyWeekday: Weekday,
  ): RecurrencePattern.MonthlyByWeekday {
    return {
      recurrenceFrequency: RecurrenceFrequency.Monthly,
      monthlyAnchor: MonthlyAnchor.Weekday,
      monthlyWeek,
      monthlyWeekday,
    };
  },
  yearly(yearlyMonth: number, yearlyDate: number): RecurrencePattern.Yearly {
    return {
      recurrenceFrequency: RecurrenceFrequency.Yearly,
      yearlyMonth,
      yearlyDate,
    };
  },

  /** Same days selected: same frequency, same anchor, same fields. */
  equals(a: RecurrencePattern, b: RecurrencePattern): boolean {
    switch (a.recurrenceFrequency) {
      case RecurrenceFrequency.Daily:
        return b.recurrenceFrequency === RecurrenceFrequency.Daily;
      case RecurrenceFrequency.Weekly: {
        if (b.recurrenceFrequency !== RecurrenceFrequency.Weekly) return false;
        if (a.recurrenceWeekdays.length !== b.recurrenceWeekdays.length) {
          return false;
        }
        for (let i = 0; i < a.recurrenceWeekdays.length; i++) {
          if (a.recurrenceWeekdays[i] !== b.recurrenceWeekdays[i]) return false;
        }
        return true;
      }
      case RecurrenceFrequency.Monthly: {
        if (b.recurrenceFrequency !== RecurrenceFrequency.Monthly) return false;
        if (a.monthlyAnchor === MonthlyAnchor.Date) {
          return (
            b.monthlyAnchor === MonthlyAnchor.Date &&
            a.monthlyDate === b.monthlyDate
          );
        }
        return (
          b.monthlyAnchor === MonthlyAnchor.Weekday &&
          a.monthlyWeek === b.monthlyWeek &&
          a.monthlyWeekday === b.monthlyWeekday
        );
      }
      case RecurrenceFrequency.Yearly:
        return (
          b.recurrenceFrequency === RecurrenceFrequency.Yearly &&
          a.yearlyMonth === b.yearlyMonth &&
          a.yearlyDate === b.yearlyDate
        );
    }
  },
} as const;

export namespace RecurrencePattern {
  export type Daily = {
    readonly recurrenceFrequency: typeof RecurrenceFrequency.Daily;
  };
  export type Weekly = {
    readonly recurrenceFrequency: typeof RecurrenceFrequency.Weekly;
    readonly recurrenceWeekdays: readonly Weekday[];
  };
  export type MonthlyByDate = {
    readonly recurrenceFrequency: typeof RecurrenceFrequency.Monthly;
    readonly monthlyAnchor: typeof MonthlyAnchor.Date;
    /** `1…31` — a month without it is skipped, never moved. */
    readonly monthlyDate: number;
  };
  export type MonthlyByWeekday = {
    readonly recurrenceFrequency: typeof RecurrenceFrequency.Monthly;
    readonly monthlyAnchor: typeof MonthlyAnchor.Weekday;
    readonly monthlyWeek: WeekOfMonth;
    readonly monthlyWeekday: Weekday;
  };
  export type Yearly = {
    readonly recurrenceFrequency: typeof RecurrenceFrequency.Yearly;
    readonly yearlyMonth: number;
    readonly yearlyDate: number;
  };
  /** The two monthly readings — what `RecurrenceSystem.monthlyDaysFor` offers. */
  export type Monthly = MonthlyByDate | MonthlyByWeekday;
}

/**
 * How a series stops — a flat variant slice of {@link RecurrenceRule}:
 * inclusively on a shop day (`untilLocalDate`), or after `occurrenceCount`
 * days.
 */
export type RecurrenceEndRule =
  RecurrenceEndRule.Until | RecurrenceEndRule.Count;

export const RecurrenceEndRule = {
  until(untilLocalDate: LocalDate): RecurrenceEndRule.Until {
    return { recurrenceEnd: RecurrenceEnd.Until, untilLocalDate };
  },
  count(occurrenceCount: number): RecurrenceEndRule.Count {
    return { recurrenceEnd: RecurrenceEnd.Count, occurrenceCount };
  },

  equals(a: RecurrenceEndRule, b: RecurrenceEndRule): boolean {
    if (a.recurrenceEnd === RecurrenceEnd.Until) {
      return (
        b.recurrenceEnd === RecurrenceEnd.Until &&
        a.untilLocalDate === b.untilLocalDate
      );
    }
    return (
      b.recurrenceEnd === RecurrenceEnd.Count &&
      a.occurrenceCount === b.occurrenceCount
    );
  },
} as const;

export namespace RecurrenceEndRule {
  export type Until = {
    readonly recurrenceEnd: typeof RecurrenceEnd.Until;
    readonly untilLocalDate: LocalDate;
  };
  export type Count = {
    readonly recurrenceEnd: typeof RecurrenceEnd.Count;
    readonly occurrenceCount: number;
  };
}

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
      return Result.ok(DAILY);
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
      return WEEKS_OF_MONTH.includes(pattern.monthlyWeek) &&
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

/** The end slice as a fresh struct (no pattern field rides along). */
function endOf(end: RecurrenceEndRule): RecurrenceEndRule {
  return end.recurrenceEnd === RecurrenceEnd.Until
    ? RecurrenceEndRule.until(end.untilLocalDate)
    : RecurrenceEndRule.count(end.occurrenceCount);
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
    return Result.ok(RecurrenceRule.of(normalized.value, interval, endOf(end)));
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
        return DAILY;
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

  /** The rule's end slice, as a fresh struct. */
  endOf(rule: RecurrenceRule): RecurrenceEndRule {
    return endOf(rule);
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
