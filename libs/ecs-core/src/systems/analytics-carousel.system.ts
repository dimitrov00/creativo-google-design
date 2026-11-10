import {
  AnalyticsPeriod,
  AnalyticsRangePreset,
  type AnalyticsReport,
  AnalyticsSpan,
  type DayRow,
} from '@core/components';
import {
  LocalDate,
  type LocationId,
  MinuteCount,
  PriceCents,
  Weekday,
} from '@core/primitives';
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

/**
 * The free time of a period, split at now (owner, 2026-11-09: «490 ч»
 * free beside «138 ч по график» read as counting time nobody works). Both
 * parts are rostered working time only — the roster's windows with its
 * breaks, blocks and closed days already out:
 * - `soFarMinutes` — free time that is gone: rostered, never booked, and
 *   past (or too near to book any more) — the schedule's unsold;
 * - `aheadMinutes` — free time still open for booking before the period
 *   ends — the schedule's open.
 */
export type AnalyticsFreeTime = {
  readonly soFarMinutes: MinuteCount;
  readonly aheadMinutes: MinuteCount;
};

/**
 * The free time by weekday (the home's free-time card): the minutes
 * gone free so far (`AnalyticsFreeTime.soFarMinutes`, the unsold) on each
 * ISO weekday, Monday first, and the weekday that holds the most — the
 * same minutes the card's figure counts.
 */
export type AnalyticsFreeWeek = {
  /** Seven entries, Monday … Sunday. */
  readonly minutes: readonly MinuteCount[];
  /** The weekday with the most free time; `null` with none at all. */
  readonly emptiest: Weekday | null;
};

/** About how many rules a money chart's grid draws. */
const TICK_COUNT = 3;
/** The grid's finest step: 1 €, in cents. */
const ONE_EURO = 100;

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
   * THE VALUE GRID of a money chart: round amounts — 1, 2 or 5 × a power
   * of ten, never under 1 € — from one step up to the first at or over the
   * highest value drawn, about three of them. Empty when nothing above
   * zero is drawn. What a line chart rules, so the reader reads the line
   * against amounts.
   */
  moneyTicksOf(values: readonly (number | null)[]): readonly PriceCents[] {
    let top = 0;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value !== null && value !== undefined && value > top) top = value;
    }
    if (top <= 0) return [];
    const rough = top / TICK_COUNT;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const norm = rough / magnitude;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = Math.max(nice * magnitude, ONE_EURO);
    const out: PriceCents[] = [];
    for (let k = 1; k * step < top + step; k++) {
      const tick = Math.round(k * step);
      if (PriceCents.is(tick)) out.push(tick);
    }
    return out;
  },

  /**
   * THE LOCATIONS' PACE — each location's running total of its takings
   * over the series buckets, cut at the bucket holding `today` as
   * {@link paceOf} cuts the shop's: one list per row of `reportLocations`,
   * in its order. Empty without a comparison of locations.
   */
  locationPacesOf(
    report: AnalyticsReport,
    today: LocalDate,
  ): readonly (readonly PriceCents[])[] {
    const latest = AnalyticsCarouselSystem.latestBucketOf(report, today);
    const out: PriceCents[][] = [];
    for (let l = 0; l < report.reportLocations.length; l++) {
      const row = report.reportLocations[l] as AnalyticsReport.LocationFigures;
      const pace: PriceCents[] = [];
      let sum = PriceCents.ZERO;
      for (let i = 0; i < row.seriesCents.length; i++) {
        if (latest === null || i > latest) break;
        sum = PriceCents.add(sum, row.seriesCents[i] as PriceCents);
        pace.push(sum);
      }
      out.push(pace);
    }
    return out;
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

  /**
   * The FREE TIME of `report`, split at now ({@link AnalyticsFreeTime}):
   * the rostered time that went unbooked so far (unsold), and the time
   * still open for booking (open). Their sum is the schedule's free (G5).
   */
  freeTimeOf(report: AnalyticsReport): AnalyticsFreeTime {
    return {
      soFarMinutes: report.reportUnsoldMinutes,
      aheadMinutes: report.reportOpenMinutes,
    };
  },

  /**
   * How full the roster was: worked time over the rostered time so far
   * ({@link rosteredSoFarOf}), `0 … 1`; `null` with nothing rostered yet.
   */
  /**
   * THE HEATMAP'S STRENGTHS, one per `reportHourGrid` cell in its order:
   * each hour's occupancy (worked over rostered) over the BUSIEST hour's,
   * `0 … 1` — the grid's own scale, so a quiet shop's peak still reads as
   * its peak (owner, 2026-11-09: at 1–5 % on an absolute scale every cell
   * was the same near-black). All zero when nothing was worked.
   */
  busyStrengthsOf(report: AnalyticsReport): readonly number[] {
    const cells = report.reportHourGrid;
    const rates: number[] = [];
    let peak = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as AnalyticsReport.HourCell;
      const rate =
        cell.rosteredMinutes > 0
          ? cell.workedMinutes / cell.rosteredMinutes
          : 0;
      rates.push(rate);
      if (rate > peak) peak = rate;
    }
    return rates.map((rate) => (peak > 0 ? Math.min(rate / peak, 1) : 0));
  },

  occupancyOf(report: AnalyticsReport): number | null {
    const rostered = AnalyticsCarouselSystem.rosteredSoFarOf(report);
    return rostered > 0
      ? Math.min(report.reportWorkedMinutes / rostered, 1)
      : null;
  },

  /**
   * THE FREE WEEK ({@link AnalyticsFreeWeek}): the day rows' unsold
   * minutes — the free time so far — summed by their day's weekday. `null` where the rows are
   * per month (a span over 93 days): a month has no weekday.
   */
  freeWeekOf(report: AnalyticsReport): AnalyticsFreeWeek | null {
    if (StaffAnalyticsSystem.dayRowsAreMonths(report)) return null;
    const minutes: MinuteCount[] = [];
    for (let i = 0; i < 7; i++) minutes.push(MinuteCount.ZERO);
    for (let i = 0; i < report.reportDayRows.length; i++) {
      const row = report.reportDayRows[i] as DayRow;
      const index = LocalDate.weekday(row.localDate) - 1;
      minutes[index] = MinuteCount.add(
        minutes[index] as MinuteCount,
        row.dayUnsoldMinutes,
      );
    }
    let emptiest: Weekday | null = null;
    let most = 0;
    for (let i = 0; i < 7; i++) {
      const free = minutes[i] as MinuteCount;
      const day = i + 1;
      if (free > most && Weekday.is(day)) {
        most = free;
        emptiest = day;
      }
    }
    return { minutes, emptiest };
  },

  /** The clients served — the worked seats: the no-show base less the no-shows. */
  servedOf(report: AnalyticsReport): number {
    return Math.max(report.reportNoShowBase - report.reportNoShowCount, 0);
  },

  /**
   * One location's row of the shop's comparison (owner review 2026-11-09)
   * — a declared projection of that location's OWN report (its scope is
   * the location): the takings and their hero pair, the worked time and
   * its occupancy ({@link occupancyOf}), the clients served
   * ({@link servedOf}) and new, the two rates and its takings per series
   * bucket. Nothing is recomputed; the location's report decided.
   */
  locationFiguresOf(
    locationId: LocationId,
    report: AnalyticsReport,
  ): AnalyticsReport.LocationFigures {
    const seriesCents: PriceCents[] = [];
    for (let i = 0; i < report.reportSeries.length; i++) {
      seriesCents.push(
        (report.reportSeries[i] as AnalyticsReport.SeriesPoint).takingsCents,
      );
    }
    return {
      locationId,
      takingsCents: report.reportTakingsCents,
      tipsCents: report.reportTipsCents,
      heroCurrentCents: report.reportHeroCurrentCents,
      heroPreviousCents: report.reportHeroPreviousCents,
      workedMinutes: report.reportWorkedMinutes,
      occupancy: AnalyticsCarouselSystem.occupancyOf(report),
      servedCount: AnalyticsCarouselSystem.servedOf(report),
      newClientCount: report.reportNewClientCount,
      rebookedRate: report.reportRebookedRate,
      noShowRate: report.reportNoShowRate,
      seriesCents,
    };
  },

  /** The tips as a share of the takings, `0 … ∞`; `null` with no takings to compare. */
  tipsShareOf(report: AnalyticsReport): number | null {
    return report.reportTakingsCents > 0
      ? report.reportTipsCents / report.reportTakingsCents
      : null;
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
