import type { Weekday } from '@core/primitives';

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
 * WHICH days of a period a rule selects, per frequency — a flat variant
 * slice of {@link RecurrenceRule}; each variant carries only what it needs,
 * every variant field prefixed by its frequency or anchor
 * (`recurrenceWeekdays`, `monthlyDate`, `yearlyMonth`). Weekdays are kept
 * unique and in ISO order by `RecurrenceRule.create`. Split out of
 * `recurrence-rule.data.ts` (pass D, D-7), with the three dictionaries of
 * its own fields.
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
