import { LocalDate, Result } from '@core/primitives';
import { AnalyticsError } from '@core/errors';
import type { DateRange } from './date-range.data';

/** How long an analytics period runs — the field `analyticsSpan`. */
export const AnalyticsSpan = {
  /** Monday to Sunday (`LocalDate.startOfWeek`). */
  Week: 'WEEK',
  /** The 1st to the month's last day. */
  Month: 'MONTH',
} as const;
export type AnalyticsSpan = (typeof AnalyticsSpan)[keyof typeof AnalyticsSpan];

/**
 * A week or a month of shop days, both ends included — what the analytics
 * screen's switcher steps through (`docs/designs/staff-analytics.md`).
 */
export type AnalyticsPeriod = DateRange & {
  readonly analyticsSpan: AnalyticsSpan;
};

/** How far back a period may start, in months before this month (the design's reach). */
const REACH_MONTHS = 12;

function lastDayOf(span: AnalyticsSpan, from: LocalDate): LocalDate {
  return span === AnalyticsSpan.Week
    ? LocalDate.addDays(from, 6)
    : LocalDate.addDays(LocalDate.addMonths(from, 1), -1);
}

export const AnalyticsPeriod = {
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

  /**
   * The period a request names — refused unless `fromLocalDate` is the first
   * day of its span (a Monday, or the 1st), so a request can never ask for a
   * range wider than one week or one month.
   */
  of(
    analyticsSpan: AnalyticsSpan,
    fromLocalDate: LocalDate,
  ): Result<AnalyticsPeriod, AnalyticsError.InvalidInput> {
    const period =
      analyticsSpan === AnalyticsSpan.Week
        ? AnalyticsPeriod.weekOf(fromLocalDate)
        : AnalyticsPeriod.monthOf(fromLocalDate);
    return period.fromLocalDate === fromLocalDate
      ? Result.ok(period)
      : Result.err(AnalyticsError.invalidInput('fromLocalDate'));
  },

  /** The period of the same span just before this one. */
  previous(period: AnalyticsPeriod): AnalyticsPeriod {
    return period.analyticsSpan === AnalyticsSpan.Week
      ? AnalyticsPeriod.weekOf(LocalDate.addDays(period.fromLocalDate, -7))
      : AnalyticsPeriod.monthOf(LocalDate.addMonths(period.fromLocalDate, -1));
  },

  /**
   * Whether the period may be asked for on `today`: it starts no earlier than
   * the 1st of the month 12 months before this one, and no later than today.
   */
  isWithinRange(period: AnalyticsPeriod, today: LocalDate): boolean {
    const earliest = LocalDate.addMonths(
      LocalDate.startOfMonth(today),
      -REACH_MONTHS,
    );
    return period.fromLocalDate >= earliest && period.fromLocalDate <= today;
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
