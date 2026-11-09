import {
  AnalyticsPeriod,
  AnalyticsRangePreset,
  type AnalyticsReport,
  AnalyticsSpan,
} from '@core/components';
import { LocalDate, MinuteCount, PriceCents } from '@core/primitives';
import { StaffAnalyticsSystem } from './staff-analytics.system';

/** The spans the home carousel pages through — every one but `CUSTOM`. */
export type AnalyticsCarouselSpan = Exclude<
  AnalyticsSpan,
  typeof AnalyticsSpan.Custom
>;

/** Six calendar months, this one included: the 1st five months back. */
const SIX_MONTHS_BACK = 5;

/**
 * THE «АНАЛИЗИ» CAROUSEL AND RANGES (`docs/designs/staff-analytics-v3-revolut.md`)
 * — which periods the home screen's carousel holds for a grain, how far back
 * a page sits (the period button's «Тази седмица» / «Миналата седмица»), and
 * what a card screen's range chips span. Pure: `today` is the shop's, the
 * reach and the switcher's steps are `AnalyticsPeriod`'s and
 * `StaffAnalyticsSystem.stepsOf`'s.
 */
/**
 * The takings' PACE (the home's takings card): the running total of the
 * period bucket by bucket — up to the bucket holding today while it runs —
 * beside the previous period's running total over its whole length, so a
 * barber reads "where am I against last month by this day".
 */
export type AnalyticsPace = {
  /** Σ takings up to each bucket, through `latestBucketOf`'s. */
  readonly current: readonly PriceCents[];
  /**
   * Σ the previous period's takings up to each bucket it has — it stops
   * where the previous period ran out of days (September under October's
   * 31st); `null` when there is no comparison at all.
   */
  readonly previous: readonly PriceCents[] | null;
  /** How many buckets the period holds — the chart's width in buckets. */
  readonly slots: number;
  /** The previous period's running total at the current's last bucket; `null` without a comparison. */
  readonly previousSoFar: PriceCents | null;
};

export const AnalyticsCarouselSystem = {
  /**
   * The carousel's pages for `span`: every period of the span the switcher
   * can reach on `today`, oldest first, the one holding today last — the
   * page the carousel opens on.
   */
  pagesOf(
    span: AnalyticsCarouselSpan,
    today: LocalDate,
  ): readonly AnalyticsPeriod[] {
    const out: AnalyticsPeriod[] = [];
    let period: AnalyticsPeriod | null = AnalyticsPeriod.holding(span, today);
    while (period !== null) {
      out.push(period);
      period = StaffAnalyticsSystem.stepsOf(period, today).previous;
    }
    return out.reverse();
  },

  /** Where `period` sits among `pages` (the same span and first day); `-1` when it is none of them. */
  pageIndexOf(
    pages: readonly AnalyticsPeriod[],
    period: AnalyticsPeriod,
  ): number {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] as AnalyticsPeriod;
      if (
        page.analyticsSpan === period.analyticsSpan &&
        page.fromLocalDate === period.fromLocalDate
      ) {
        return i;
      }
    }
    return -1;
  },

  /**
   * How many periods of its span `period` lies before the one holding
   * `today`: 0 for the current one, 1 for the one before; `null` for a
   * `CUSTOM` range, which has no such neighbour, and for a period ahead.
   */
  stepsBackOf(period: AnalyticsPeriod, today: LocalDate): number | null {
    if (period.analyticsSpan === AnalyticsSpan.Custom) return null;
    if (period.fromLocalDate > today) return null;
    const pages = AnalyticsCarouselSystem.pagesOf(period.analyticsSpan, today);
    const index = AnalyticsCarouselSystem.pageIndexOf(pages, period);
    return index < 0 ? null : pages.length - 1 - index;
  },

  /**
   * The period a range chip spans on `today`: the week, the month or the
   * year holding today; six calendar months up to today; or the whole reach
   * — the last 366 days (`CUSTOM_MAX_DAYS`), never before its first day.
   */
  rangeOf(preset: AnalyticsRangePreset, today: LocalDate): AnalyticsPeriod {
    switch (preset) {
      case AnalyticsRangePreset.Week:
        return AnalyticsPeriod.weekOf(today);
      case AnalyticsRangePreset.Month:
        return AnalyticsPeriod.monthOf(today);
      case AnalyticsRangePreset.Year:
        return AnalyticsPeriod.yearOf(today);
      case AnalyticsRangePreset.SixMonths:
        return AnalyticsPeriod.customOf(
          LocalDate.addMonths(LocalDate.startOfMonth(today), -SIX_MONTHS_BACK),
          today,
        );
      case AnalyticsRangePreset.Max: {
        const longest = LocalDate.addDays(
          today,
          -(AnalyticsPeriod.CUSTOM_MAX_DAYS - 1),
        );
        const earliest = AnalyticsPeriod.earliestOn(today);
        return AnalyticsPeriod.customOf(
          longest > earliest ? longest : earliest,
          today,
        );
      }
    }
  },

  /**
   * What one bucket of `report`'s series is — the «средно … на ден» of the
   * takings card: a month on a `YEAR`, an ISO week on a range over 93 days
   * (`StaffAnalyticsSystem.dayRowsAreMonths`' rule), else a day.
   */
  seriesBucketOf(
    report: AnalyticsReport,
  ): Exclude<AnalyticsCarouselSpan, typeof AnalyticsSpan.Year> {
    if (report.reportAnalyticsSpan === AnalyticsSpan.Year) {
      return AnalyticsSpan.Month;
    }
    return StaffAnalyticsSystem.dayRowsAreMonths(report)
      ? AnalyticsSpan.Week
      : AnalyticsSpan.Day;
  },

  /**
   * The series bucket a card highlights: the one holding `today` while the
   * period runs, its last one once the period is past; `null` without a
   * series.
   */
  latestBucketOf(report: AnalyticsReport, today: LocalDate): number | null {
    const points = report.reportSeries;
    if (points.length === 0) return null;
    let index = 0;
    for (let i = 0; i < points.length; i++) {
      if ((points[i] as AnalyticsReport.SeriesPoint).localDate <= today) {
        index = i;
      }
    }
    return index;
  },

  /**
   * THE PACE of `report`'s takings ({@link AnalyticsPace}): running totals
   * of the series, the current one cut at the bucket holding `today` (the
   * last on a past period), the comparison's over every bucket it covers
   * — up to its first bucket without one, a shorter previous period's end
   * — and absent when the first bucket has none (a period not comparable).
   * The previous total "so far" is read at the current's last bucket, or
   * at the previous period's own end when that came sooner.
   */
  paceOf(report: AnalyticsReport, today: LocalDate): AnalyticsPace {
    const points = report.reportSeries;
    const latest = AnalyticsCarouselSystem.latestBucketOf(report, today);
    const current: PriceCents[] = [];
    const previous: PriceCents[] = [];
    let sum = PriceCents.ZERO;
    let comparisonSum = PriceCents.ZERO;
    let covered = true;
    for (let i = 0; i < points.length; i++) {
      const point = points[i] as AnalyticsReport.SeriesPoint;
      sum = PriceCents.add(sum, point.takingsCents);
      if (latest !== null && i <= latest) current.push(sum);
      if (point.comparisonTakingsCents === null) covered = false;
      if (covered && point.comparisonTakingsCents !== null) {
        comparisonSum = PriceCents.add(
          comparisonSum,
          point.comparisonTakingsCents,
        );
        previous.push(comparisonSum);
      }
    }
    const comparable = previous.length > 0;
    return {
      current,
      previous: comparable ? previous : null,
      slots: points.length,
      previousSoFar:
        comparable && latest !== null
          ? (previous[Math.min(latest, previous.length - 1)] ?? null)
          : null,
    };
  },

  /**
   * The rostered time up to now the working-time card measures worked
   * against: the time bar's six parts together (worked, no-show, unmarked,
   * blocked, unsold, other) — the roster less breaks, up to the minute.
   */
  rosteredSoFarOf(report: AnalyticsReport): MinuteCount {
    let total = MinuteCount.ZERO;
    for (const part of [
      report.reportBarWorkedMinutes,
      report.reportBarNoShowMinutes,
      report.reportBarUnmarkedMinutes,
      report.reportBarBlockedMinutes,
      report.reportBarUnsoldMinutes,
      report.reportBarOtherMinutes,
    ]) {
      total = MinuteCount.add(total, part);
    }
    return total;
  },

  /** The tips as a share of the takings, `0 … ∞`; `null` with no takings to compare. */
  tipsShareOf(report: AnalyticsReport): number | null {
    return report.reportTakingsCents > 0
      ? report.reportTipsCents / report.reportTakingsCents
      : null;
  },

  /**
   * The tips per bucket of `report`'s series — the day rows' tips summed
   * into the bucket each row's day falls in, aligned with
   * `reportSeries`. `null` where the rows cannot be placed: a range over
   * 93 days that is no `YEAR` keeps a row per barber-MONTH against weekly
   * buckets.
   */
  tipsSeriesOf(report: AnalyticsReport): readonly number[] | null {
    const points = report.reportSeries;
    if (
      report.reportAnalyticsSpan !== AnalyticsSpan.Year &&
      StaffAnalyticsSystem.dayRowsAreMonths(report)
    ) {
      return null;
    }
    const out = points.map(() => 0);
    for (const row of report.reportDayRows) {
      let bucket = -1;
      for (let i = 0; i < points.length; i++) {
        if (
          (points[i] as AnalyticsReport.SeriesPoint).localDate <= row.localDate
        ) {
          bucket = i;
        }
      }
      if (bucket >= 0) out[bucket] = (out[bucket] as number) + row.dayTipsCents;
    }
    return out;
  },

  /** The range chip `period` is on `today`, or `null` — a day, a past week, a range of the sheet's. */
  presetOf(
    period: AnalyticsPeriod,
    today: LocalDate,
  ): AnalyticsRangePreset | null {
    for (const preset of Object.values(AnalyticsRangePreset)) {
      const range = AnalyticsCarouselSystem.rangeOf(preset, today);
      if (
        range.analyticsSpan === period.analyticsSpan &&
        range.fromLocalDate === period.fromLocalDate &&
        range.toLocalDate === period.toLocalDate
      ) {
        return preset;
      }
    }
    return null;
  },
} as const;
