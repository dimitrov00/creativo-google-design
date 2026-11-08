import { LocalDate, Result } from '@core/primitives';
import { AnalyticsError } from '@core/errors';
import type { DateRange } from './date-range.data';

/** How long an analytics period runs — the field `analyticsSpan`. */
export const AnalyticsSpan = {
  /** One shop day. */
  Day: 'DAY',
  /** Monday to Sunday (`LocalDate.startOfWeek`). */
  Week: 'WEEK',
  /** The 1st to the month's last day. */
  Month: 'MONTH',
} as const;
export type AnalyticsSpan = (typeof AnalyticsSpan)[keyof typeof AnalyticsSpan];

/**
 * Which period a report is compared with — the field `analyticsComparison`
 * (`docs/designs/staff-analytics-v2.md`, Terms · Comparison period).
 */
export const AnalyticsComparison = {
  /** The previous period of the same span (`AnalyticsPeriod.previous`). */
  Previous: 'PREVIOUS',
  /** The same period a year earlier — named by the contract, not served in v2. */
  SameLastYear: 'SAME_LAST_YEAR',
} as const;
export type AnalyticsComparison =
  (typeof AnalyticsComparison)[keyof typeof AnalyticsComparison];

/**
 * A day, a week or a month of shop days, both ends included — what the
 * analytics screen's switcher steps through
 * (`docs/designs/staff-analytics-v2.md`).
 */
export type AnalyticsPeriod = DateRange & {
  readonly analyticsSpan: AnalyticsSpan;
};

/** How far back a period may start, in months before this month (the design's reach). */
const REACH_MONTHS = 12;

/** The days of a week — a `DAY`'s comparison is the same weekday a week earlier. */
const DAYS_PER_WEEK = 7;

function lastDayOf(span: AnalyticsSpan, from: LocalDate): LocalDate {
  switch (span) {
    case AnalyticsSpan.Day:
      return from;
    case AnalyticsSpan.Week:
      return LocalDate.addDays(from, 6);
    case AnalyticsSpan.Month:
      return LocalDate.addDays(LocalDate.addMonths(from, 1), -1);
  }
}

/** The earliest day a period may start on `today`: the 1st of the month 12 months before this one. */
function earliestOn(today: LocalDate): LocalDate {
  return LocalDate.addMonths(LocalDate.startOfMonth(today), -REACH_MONTHS);
}

export const AnalyticsPeriod = {
  /** The one day `localDate`. */
  dayOf(localDate: LocalDate): AnalyticsPeriod {
    return {
      analyticsSpan: AnalyticsSpan.Day,
      fromLocalDate: localDate,
      toLocalDate: lastDayOf(AnalyticsSpan.Day, localDate),
    };
  },

  /** The week that holds `localDate`. */
  weekOf(localDate: LocalDate): AnalyticsPeriod {
    const from = LocalDate.startOfWeek(localDate);
    return {
      analyticsSpan: AnalyticsSpan.Week,
      fromLocalDate: from,
      toLocalDate: lastDayOf(AnalyticsSpan.Week, from),
    };
  },

  /** The month that holds `localDate`. */
  monthOf(localDate: LocalDate): AnalyticsPeriod {
    const from = LocalDate.startOfMonth(localDate);
    return {
      analyticsSpan: AnalyticsSpan.Month,
      fromLocalDate: from,
      toLocalDate: lastDayOf(AnalyticsSpan.Month, from),
    };
  },

  /** The period of `span` that holds `localDate`. */
  holding(span: AnalyticsSpan, localDate: LocalDate): AnalyticsPeriod {
    switch (span) {
      case AnalyticsSpan.Day:
        return AnalyticsPeriod.dayOf(localDate);
      case AnalyticsSpan.Week:
        return AnalyticsPeriod.weekOf(localDate);
      case AnalyticsSpan.Month:
        return AnalyticsPeriod.monthOf(localDate);
    }
  },

  /**
   * The period a request names — refused unless `fromLocalDate` is the first
   * day of its span (any day for `DAY`, a Monday, or the 1st), so a request
   * can never ask for a range wider than one day, one week or one month.
   */
  of(
    analyticsSpan: AnalyticsSpan,
    fromLocalDate: LocalDate,
  ): Result<AnalyticsPeriod, AnalyticsError.InvalidInput> {
    const period = AnalyticsPeriod.holding(analyticsSpan, fromLocalDate);
    return period.fromLocalDate === fromLocalDate
      ? Result.ok(period)
      : Result.err(AnalyticsError.invalidInput('fromLocalDate'));
  },

  /**
   * The comparison period (design, Terms): for a `DAY` the same weekday a
   * week earlier; for a `WEEK` or a `MONTH` the one just before this one.
   */
  previous(period: AnalyticsPeriod): AnalyticsPeriod {
    switch (period.analyticsSpan) {
      case AnalyticsSpan.Day:
        return AnalyticsPeriod.dayOf(
          LocalDate.addDays(period.fromLocalDate, -DAYS_PER_WEEK),
        );
      case AnalyticsSpan.Week:
        return AnalyticsPeriod.weekOf(
          LocalDate.addDays(period.fromLocalDate, -DAYS_PER_WEEK),
        );
      case AnalyticsSpan.Month:
        return AnalyticsPeriod.monthOf(
          LocalDate.addMonths(period.fromLocalDate, -1),
        );
    }
  },

  /**
   * Whether the period may be asked for on `today`: it starts no earlier than
   * the 1st of the month 12 months before this one, and no later than today.
   */
  isWithinRange(period: AnalyticsPeriod, today: LocalDate): boolean {
    return (
      period.fromLocalDate >= earliestOn(today) && period.fromLocalDate <= today
    );
  },

  /**
   * Whether the period's comparison period may be read on `today`: it
   * starts no earlier than the reach (the same earliest day
   * `isWithinRange` admits). A period at the reach's edge is not
   * comparable — its comparison fields are `null` and the chip says so.
   */
  isComparable(period: AnalyticsPeriod, today: LocalDate): boolean {
    return AnalyticsPeriod.previous(period).fromLocalDate >= earliestOn(today);
  },

  /** Every day of the period, in order. */
  days(period: AnalyticsPeriod): readonly LocalDate[] {
    return LocalDate.range(period.fromLocalDate, period.toLocalDate);
  },

  /** The period's length in days. */
  length(period: AnalyticsPeriod): number {
    return LocalDate.daysBetween(period.fromLocalDate, period.toLocalDate) + 1;
  },
} as const;
