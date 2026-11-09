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
  /** 1 January to 31 December. */
  Year: 'YEAR',
  /** Any `from ≤ to` of at most {@link CUSTOM_MAX_DAYS} days — the range sheet's. */
  Custom: 'CUSTOM',
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
 * A card screen's range chip — the field `rangePreset`
 * (`docs/designs/staff-analytics-v3-revolut.md`, «A card's screen»): the
 * week, the month, six calendar months, the year, or the whole reach, each
 * up to today (`AnalyticsCarouselSystem.rangeOf`).
 */
export const AnalyticsRangePreset = {
  /** «1С» — the week holding today. */
  Week: 'WEEK',
  /** «1М» — the month holding today. */
  Month: 'MONTH',
  /** «6М» — the 1st of the month five months back to today. */
  SixMonths: 'SIX_MONTHS',
  /** «1Г» — the year holding today. */
  Year: 'YEAR',
  /** «МАКС» — the last 366 days, never before the reach. */
  Max: 'MAX',
} as const;
export type AnalyticsRangePreset =
  (typeof AnalyticsRangePreset)[keyof typeof AnalyticsRangePreset];

/**
 * A day, a week, a month, a year or a custom range of shop days, both ends
 * included — what the analytics screen's switcher steps through
 * (`docs/designs/staff-analytics-v2.md`, Terms · Span).
 */
export type AnalyticsPeriod = DateRange & {
  readonly analyticsSpan: AnalyticsSpan;
};

/** How far back a period may start, in months before this month (the design's reach). */
const REACH_MONTHS = 12;

/** The days of a week — a `DAY`'s comparison is the same weekday a week earlier. */
const DAYS_PER_WEEK = 7;

/** The months of a year — a `YEAR` runs this many from 1 January. */
const MONTHS_PER_YEAR = 12;

/** The most days a `CUSTOM` range spans — a leap year's (design, Terms · Span). */
const CUSTOM_MAX_DAYS = 366;

/** The earliest day a period may start on `today`: the 1st of the month 12 months before this one. */
function earliestOn(today: LocalDate): LocalDate {
  return LocalDate.addMonths(LocalDate.startOfMonth(today), -REACH_MONTHS);
}

/** The period's length in days. */
function lengthOf(period: DateRange): number {
  return LocalDate.daysBetween(period.fromLocalDate, period.toLocalDate) + 1;
}

export const AnalyticsPeriod = {
  /**
   * The reach's first day on `today` — the 1st of the month
   * {@link REACH_MONTHS} before this one: the earliest day a period may
   * start, and the first day the recompute's full pass walks.
   */
  earliestOn,

  /** The most days a `CUSTOM` range spans; a longer one is `ANALYTICS_PERIOD_OUT_OF_RANGE`. */
  CUSTOM_MAX_DAYS,

  /** The one day `localDate`. */
  dayOf(localDate: LocalDate): AnalyticsPeriod {
    return {
      analyticsSpan: AnalyticsSpan.Day,
      fromLocalDate: localDate,
      toLocalDate: localDate,
    };
  },

  /** The week that holds `localDate`. */
  weekOf(localDate: LocalDate): AnalyticsPeriod {
    const from = LocalDate.startOfWeek(localDate);
    return {
      analyticsSpan: AnalyticsSpan.Week,
      fromLocalDate: from,
      toLocalDate: LocalDate.addDays(from, DAYS_PER_WEEK - 1),
    };
  },

  /** The month that holds `localDate`. */
  monthOf(localDate: LocalDate): AnalyticsPeriod {
    const from = LocalDate.startOfMonth(localDate);
    return {
      analyticsSpan: AnalyticsSpan.Month,
      fromLocalDate: from,
      toLocalDate: LocalDate.addDays(LocalDate.addMonths(from, 1), -1),
    };
  },

  /** The year that holds `localDate` — 1 January to 31 December. */
  yearOf(localDate: LocalDate): AnalyticsPeriod {
    const from = LocalDate.startOfYear(localDate);
    return {
      analyticsSpan: AnalyticsSpan.Year,
      fromLocalDate: from,
      toLocalDate: LocalDate.addDays(
        LocalDate.addMonths(from, MONTHS_PER_YEAR),
        -1,
      ),
    };
  },

  /**
   * The custom range `fromLocalDate … toLocalDate`, as given — the unchecked
   * builder a step or a comparison derives its neighbour with; a REQUEST
   * goes through {@link of}, which refuses an inverted or over-long range.
   */
  customOf(fromLocalDate: LocalDate, toLocalDate: LocalDate): AnalyticsPeriod {
    return { analyticsSpan: AnalyticsSpan.Custom, fromLocalDate, toLocalDate };
  },

  /**
   * The period of `span` that holds `localDate`. A `CUSTOM` range is picked
   * by the sheet, never derived from a day: the one holding `localDate` is
   * the one-day range.
   */
  holding(span: AnalyticsSpan, localDate: LocalDate): AnalyticsPeriod {
    switch (span) {
      case AnalyticsSpan.Day:
        return AnalyticsPeriod.dayOf(localDate);
      case AnalyticsSpan.Week:
        return AnalyticsPeriod.weekOf(localDate);
      case AnalyticsSpan.Month:
        return AnalyticsPeriod.monthOf(localDate);
      case AnalyticsSpan.Year:
        return AnalyticsPeriod.yearOf(localDate);
      case AnalyticsSpan.Custom:
        return AnalyticsPeriod.customOf(localDate, localDate);
    }
  },

  /**
   * The period a request names (design, The callable v2 contract).
   * `toLocalDate` is `null` unless the span is `CUSTOM`: a `to` on another
   * span, or none on `CUSTOM`, is `ANALYTICS_INVALID_INPUT` on
   * `toLocalDate`. A fixed span is refused unless `fromLocalDate` is its
   * first day (any day for `DAY`, a Monday, a 1st, 1 January), so a request
   * can never ask for a range wider than its span; a `CUSTOM` range is
   * refused when inverted (`toLocalDate`) and `ANALYTICS_PERIOD_OUT_OF_RANGE`
   * when longer than {@link CUSTOM_MAX_DAYS}.
   */
  of(
    analyticsSpan: AnalyticsSpan,
    fromLocalDate: LocalDate,
    toLocalDate: LocalDate | null,
  ): Result<
    AnalyticsPeriod,
    AnalyticsError.InvalidInput | AnalyticsError.PeriodOutOfRange
  > {
    if (analyticsSpan === AnalyticsSpan.Custom) {
      if (toLocalDate === null || toLocalDate < fromLocalDate) {
        return Result.err(AnalyticsError.invalidInput('toLocalDate'));
      }
      const custom = AnalyticsPeriod.customOf(fromLocalDate, toLocalDate);
      return lengthOf(custom) > CUSTOM_MAX_DAYS
        ? Result.err(AnalyticsError.periodOutOfRange(fromLocalDate))
        : Result.ok(custom);
    }
    if (toLocalDate !== null) {
      return Result.err(AnalyticsError.invalidInput('toLocalDate'));
    }
    const period = AnalyticsPeriod.holding(analyticsSpan, fromLocalDate);
    return period.fromLocalDate === fromLocalDate
      ? Result.ok(period)
      : Result.err(AnalyticsError.invalidInput('fromLocalDate'));
  },

  /**
   * The comparison period (design, Terms): for a `DAY` the same weekday a
   * week earlier; for a `WEEK`, a `MONTH` or a `YEAR` the one just before
   * this one; for a `CUSTOM` range the same length ending the day before.
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
      case AnalyticsSpan.Year:
        return AnalyticsPeriod.yearOf(
          LocalDate.addMonths(period.fromLocalDate, -MONTHS_PER_YEAR),
        );
      case AnalyticsSpan.Custom: {
        const to = LocalDate.addDays(period.fromLocalDate, -1);
        return AnalyticsPeriod.customOf(
          LocalDate.addDays(to, 1 - lengthOf(period)),
          to,
        );
      }
    }
  },

  /**
   * Whether the period may be asked for on `today`: it starts no earlier than
   * the 1st of the month 12 months before this one, and no later than today
   * — its first day alone decides, a `CUSTOM` range's included.
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
   * comparable — its comparison fields are `null` and the chip says so; a
   * `YEAR` is comparable only while the year before starts inside the reach.
   */
  isComparable(period: AnalyticsPeriod, today: LocalDate): boolean {
    return AnalyticsPeriod.previous(period).fromLocalDate >= earliestOn(today);
  },

  /** Every day of the period, in order. */
  days(period: AnalyticsPeriod): readonly LocalDate[] {
    return LocalDate.range(period.fromLocalDate, period.toLocalDate);
  },

  /** The period's length in days. */
  length: lengthOf,
} as const;
