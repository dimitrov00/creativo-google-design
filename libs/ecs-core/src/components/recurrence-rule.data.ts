import { DayKey } from './day-key.data';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';
import { Weekday } from './weekday.data';

/** How often a rule repeats — the ONLY source of these strings. */
export const Frequency = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
} as const;
export type Frequency = (typeof Frequency)[keyof typeof Frequency];

/**
 * Which week of its month a day is in: the first … the fourth, or the LAST.
 * There is no fifth — a fifth weekday is always the last one, and «last» is
 * the reading that still means something in a four-week month.
 */
export const WeekOfMonth = {
  First: 1,
  Second: 2,
  Third: 3,
  Fourth: 4,
  Last: -1,
} as const;
export type WeekOfMonth = (typeof WeekOfMonth)[keyof typeof WeekOfMonth];

/** How a monthly rule finds its day — iCalendar's `BYMONTHDAY` or ordinal `BYDAY`. */
export const MonthlyDayKind = {
  /** «on the 24th». */
  Date: 'date',
  /** «on the fourth Thursday», «on the last Thursday». */
  Weekday: 'weekday',
} as const;
export type MonthlyDayKind =
  (typeof MonthlyDayKind)[keyof typeof MonthlyDayKind];

/** How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`. */
export const RecurrenceEndKind = {
  Until: 'until',
  Count: 'count',
} as const;
export type RecurrenceEndKind =
  (typeof RecurrenceEndKind)[keyof typeof RecurrenceEndKind];

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
 * A RECURRENCE RULE — which days a thing repeats on, and when it stops: the
 * part of iCalendar's RRULE (RFC 5545) Calendar, Google Calendar and Outlook
 * put in front of people (`recurrence-rule.ts:16-68`). Every day, a weekday
 * set, every month on a date or on «the fourth Thursday», every year; every
 * `interval`-th period; until a day or for N times.
 *
 * Explicit, never implied: every pattern names its days, so two rules are
 * equal exactly when they select the same days (weekdays are kept unique and
 * in ISO order). Days that do not exist are SKIPPED, never moved — «monthly on
 * the 31st» has no April. There is deliberately no «never»: a block series is
 * WRITTEN day by day, so a series materialises at most
 * {@link RecurrenceRule.MAX_OCCURRENCES} days. The walk itself is
 * `RecurrenceSystem.occurrences`; a series is not stored (§9 D16(b)).
 */
export type RecurrenceRule = {
  readonly pattern: RecurrenceRule.Pattern;
  /** Every `interval`-th period — «every 2 weeks»; `1…MAX_INTERVAL`. */
  readonly interval: number;
  readonly end: RecurrenceRule.End;
};

function isIsoWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/** The pattern made canonical, or the reason it cannot occur. */
function normalize(
  pattern: RecurrenceRule.Pattern,
): Result<RecurrenceRule.Pattern, SchedulingError> {
  switch (pattern.kind) {
    case Frequency.Daily:
      return Result.ok(pattern);
    case Frequency.Weekly: {
      const weekdays: Weekday[] = [];
      for (let i = 0; i < ISO_WEEK.length; i++) {
        const weekday = ISO_WEEK[i] as Weekday;
        if (pattern.weekdays.includes(weekday)) weekdays.push(weekday);
      }
      return weekdays.length === 0
        ? Result.err(SchedulingError.recurrenceNoWeekdays())
        : Result.ok({ kind: Frequency.Weekly, weekdays });
    }
    case Frequency.Monthly: {
      const day = pattern.day;
      if (day.kind === MonthlyDayKind.Date) {
        return Number.isInteger(day.date) && day.date >= 1 && day.date <= 31
          ? Result.ok(pattern)
          : Result.err(SchedulingError.recurrenceInvalidDay(null, day.date));
      }
      return WEEKS_OF_MONTH.includes(day.week) && isIsoWeekday(day.weekday)
        ? Result.ok(pattern)
        : Result.err(SchedulingError.recurrenceInvalidDay(null, day.week));
    }
    case Frequency.Yearly: {
      const { month, date } = pattern;
      // Judged against a LEAP year (2000): 29 February is a real, if
      // quadrennial, anniversary; 30 February is not a day at all.
      const real =
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        Number.isInteger(date) &&
        date >= 1 &&
        date <= DayKey.daysInMonth(LEAP_YEAR, month);
      return real
        ? Result.ok(pattern)
        : Result.err(SchedulingError.recurrenceInvalidDay(month, date));
    }
  }
}

function samePattern(
  a: RecurrenceRule.Pattern,
  b: RecurrenceRule.Pattern,
): boolean {
  switch (a.kind) {
    case Frequency.Daily:
      return b.kind === Frequency.Daily;
    case Frequency.Weekly: {
      if (b.kind !== Frequency.Weekly) return false;
      if (a.weekdays.length !== b.weekdays.length) return false;
      for (let i = 0; i < a.weekdays.length; i++) {
        if (a.weekdays[i] !== b.weekdays[i]) return false;
      }
      return true;
    }
    case Frequency.Monthly: {
      if (b.kind !== Frequency.Monthly) return false;
      const x = a.day;
      const y = b.day;
      if (x.kind === MonthlyDayKind.Date) {
        return y.kind === MonthlyDayKind.Date && x.date === y.date;
      }
      return (
        y.kind === MonthlyDayKind.Weekday &&
        x.week === y.week &&
        x.weekday === y.weekday
      );
    }
    case Frequency.Yearly:
      return (
        b.kind === Frequency.Yearly && a.month === b.month && a.date === b.date
      );
  }
}

function sameEnd(a: RecurrenceRule.End, b: RecurrenceRule.End): boolean {
  if (a.kind === RecurrenceEndKind.Until) {
    return b.kind === RecurrenceEndKind.Until && a.dayKey === b.dayKey;
  }
  return b.kind === RecurrenceEndKind.Count && a.count === b.count;
}

export const RecurrenceRule = {
  /** Every 1…99 periods. Apple's wheel stops at 999; a shop's has no use past 99. */
  MAX_INTERVAL,
  /** The most days one series may write — a year of them. */
  MAX_OCCURRENCES,

  /**
   * The edge guard and the canonicaliser: an interval of `1…MAX_INTERVAL`
   * (`scheduling.recurrence.invalid_interval`), a count of
   * `1…MAX_OCCURRENCES` (`scheduling.recurrence.invalid_count`), and a
   * pattern that can occur — at least one weekday
   * (`scheduling.recurrence.no_weekdays`), a real day
   * (`scheduling.recurrence.invalid_day`). Weekdays come back unique and in
   * ISO order.
   */
  create(
    pattern: RecurrenceRule.Pattern,
    interval: number,
    end: RecurrenceRule.End,
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
      end.kind === RecurrenceEndKind.Count &&
      (!Number.isInteger(end.count) ||
        end.count < 1 ||
        end.count > MAX_OCCURRENCES)
    ) {
      return Result.err(
        SchedulingError.recurrenceInvalidCount(end.count, MAX_OCCURRENCES),
      );
    }
    const normalized = normalize(pattern);
    if (!normalized.ok) return normalized;
    return Result.ok({ pattern: normalized.value, interval, end });
  },

  frequency(rule: RecurrenceRule): Frequency {
    return rule.pattern.kind;
  },

  /** Same days, same interval, same end. */
  equals(a: RecurrenceRule, b: RecurrenceRule | null): boolean {
    return (
      b !== null &&
      a.interval === b.interval &&
      samePattern(a.pattern, b.pattern) &&
      sameEnd(a.end, b.end)
    );
  },
} as const;

export namespace RecurrenceRule {
  /** WHICH days of a period, per frequency; each arm carries only what it needs. */
  export type Pattern = Daily | Weekly | Monthly | Yearly;
  export type Daily = { readonly kind: typeof Frequency.Daily };
  export type Weekly = {
    readonly kind: typeof Frequency.Weekly;
    readonly weekdays: readonly Weekday[];
  };
  export type Monthly = {
    readonly kind: typeof Frequency.Monthly;
    readonly day: MonthlyDay;
  };
  export type Yearly = {
    readonly kind: typeof Frequency.Yearly;
    readonly month: number;
    readonly date: number;
  };

  /** A monthly rule's day. */
  export type MonthlyDay = ByDate | ByWeekday;
  export type ByDate = {
    readonly kind: typeof MonthlyDayKind.Date;
    readonly date: number;
  };
  export type ByWeekday = {
    readonly kind: typeof MonthlyDayKind.Weekday;
    readonly week: WeekOfMonth;
    readonly weekday: Weekday;
  };

  /** How the series stops. */
  export type End = Until | Count;
  export type Until = {
    readonly kind: typeof RecurrenceEndKind.Until;
    readonly dayKey: DayKey;
  };
  export type Count = {
    readonly kind: typeof RecurrenceEndKind.Count;
    readonly count: number;
  };
}
