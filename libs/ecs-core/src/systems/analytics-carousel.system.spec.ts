import { describe, expect, it } from 'vitest';
import {
  AnalyticsPeriod,
  AnalyticsRangePreset,
  type AnalyticsReport,
  AnalyticsSpan,
} from '@core/components';
import { analyticsReportFixture, deepFreeze, localDate } from '@core/testing';
import {
  LocationId,
  type MinuteCount,
  type PriceCents,
} from '@core/primitives';
import { AnalyticsCarouselSystem as C } from './analytics-carousel.system';

/** A Monday in November: the reach starts on 1 November 2025. */
const TODAY = localDate('2026-11-09');

describe('AnalyticsCarouselSystem.pagesOf — the carousel’s pages', () => {
  it('holds every month of the reach, oldest first, this month last', () => {
    const pages = C.pagesOf(AnalyticsSpan.Month, TODAY);
    expect(pages).toHaveLength(13);
    expect(pages[0]).toEqual(AnalyticsPeriod.monthOf(localDate('2025-11-01')));
    expect(pages.at(-1)).toEqual(AnalyticsPeriod.monthOf(TODAY));
  });

  it('holds the weeks back to the one starting in the reach, and the days back to its first day', () => {
    const weeks = C.pagesOf(AnalyticsSpan.Week, TODAY);
    expect(weeks.at(-1)).toEqual(AnalyticsPeriod.weekOf(TODAY));
    expect(weeks[0]?.fromLocalDate).toBe('2025-11-03');
    const days = C.pagesOf(AnalyticsSpan.Day, TODAY);
    expect(days[0]).toEqual(AnalyticsPeriod.dayOf(localDate('2025-11-01')));
    expect(days.at(-1)).toEqual(AnalyticsPeriod.dayOf(TODAY));
    expect(days).toHaveLength(374);
  });

  it('holds this year alone: last year starts before the reach (v2: a period never starts before it)', () => {
    const years = C.pagesOf(AnalyticsSpan.Year, TODAY);
    expect(years.map((y) => y.fromLocalDate)).toEqual(['2026-01-01']);
  });
});

describe('AnalyticsCarouselSystem.stepsBackOf — how far back a page sits', () => {
  it('counts this period as 0, the one before as 1', () => {
    expect(C.stepsBackOf(AnalyticsPeriod.monthOf(TODAY), TODAY)).toBe(0);
    expect(
      C.stepsBackOf(AnalyticsPeriod.monthOf(localDate('2026-10-15')), TODAY),
    ).toBe(1);
    expect(
      C.stepsBackOf(AnalyticsPeriod.weekOf(localDate('2026-10-28')), TODAY),
    ).toBe(2);
    expect(
      C.stepsBackOf(AnalyticsPeriod.dayOf(localDate('2026-11-08')), TODAY),
    ).toBe(1);
  });

  it('has no answer for a custom range, a period ahead or one past the reach', () => {
    expect(
      C.stepsBackOf(
        AnalyticsPeriod.customOf(localDate('2026-11-01'), TODAY),
        TODAY,
      ),
    ).toBeNull();
    expect(
      C.stepsBackOf(AnalyticsPeriod.monthOf(localDate('2026-12-01')), TODAY),
    ).toBeNull();
    expect(
      C.stepsBackOf(AnalyticsPeriod.monthOf(localDate('2025-06-01')), TODAY),
    ).toBeNull();
  });
});

describe('AnalyticsCarouselSystem.rangeOf and presetOf — the range chips', () => {
  it('spans the week, the month and the year holding today, six calendar months, and the last 366 days', () => {
    expect(C.rangeOf(AnalyticsRangePreset.Week, TODAY)).toEqual(
      AnalyticsPeriod.weekOf(TODAY),
    );
    expect(C.rangeOf(AnalyticsRangePreset.Month, TODAY)).toEqual(
      AnalyticsPeriod.monthOf(TODAY),
    );
    expect(C.rangeOf(AnalyticsRangePreset.Year, TODAY)).toEqual(
      AnalyticsPeriod.yearOf(TODAY),
    );
    expect(C.rangeOf(AnalyticsRangePreset.SixMonths, TODAY)).toEqual(
      AnalyticsPeriod.customOf(localDate('2026-06-01'), TODAY),
    );
    // The reach starts on 1 Nov 2025, 374 days back: the last 366 days start later.
    expect(C.rangeOf(AnalyticsRangePreset.Max, TODAY)).toEqual(
      AnalyticsPeriod.customOf(localDate('2025-11-09'), TODAY),
    );
  });

  it('never starts МАКС before the reach', () => {
    // On 2 Jan the reach starts on 1 Jan of last year: 367 days back, so 366 fit.
    const early = localDate('2026-01-02');
    expect(C.rangeOf(AnalyticsRangePreset.Max, early).fromLocalDate).toBe(
      '2025-01-02',
    );
    const day = localDate('2026-01-31');
    const max = C.rangeOf(AnalyticsRangePreset.Max, day);
    expect(max.fromLocalDate >= AnalyticsPeriod.earliestOn(day)).toBe(true);
  });

  it('names the chip a period is, and none for a day, a past week or a sheet’s range', () => {
    for (const preset of Object.values(AnalyticsRangePreset)) {
      expect(C.presetOf(C.rangeOf(preset, TODAY), TODAY)).toBe(preset);
    }
    expect(C.presetOf(AnalyticsPeriod.dayOf(TODAY), TODAY)).toBeNull();
    expect(
      C.presetOf(AnalyticsPeriod.weekOf(localDate('2026-11-01')), TODAY),
    ).toBeNull();
    expect(
      C.presetOf(
        AnalyticsPeriod.customOf(localDate('2026-10-01'), TODAY),
        TODAY,
      ),
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const period = deepFreeze(AnalyticsPeriod.monthOf(TODAY));
    expect(C.stepsBackOf(period, TODAY)).toBe(C.stepsBackOf(period, TODAY));
    expect(C.pagesOf(AnalyticsSpan.Week, TODAY)).toEqual(
      C.pagesOf(AnalyticsSpan.Week, TODAY),
    );
  });
});

describe('AnalyticsCarouselSystem — what a bento card measures', () => {
  it('names the series’ bucket: a day up to 93 days, a week beyond, a month on a year', () => {
    expect(C.seriesBucketOf(analyticsReportFixture())).toBe(AnalyticsSpan.Day);
    expect(
      C.seriesBucketOf(
        analyticsReportFixture({
          reportAnalyticsSpan: AnalyticsSpan.Custom,
          reportFromLocalDate: localDate('2026-01-01'),
          reportToLocalDate: localDate('2026-09-30'),
        }),
      ),
    ).toBe(AnalyticsSpan.Week);
    expect(
      C.seriesBucketOf(
        analyticsReportFixture({
          reportAnalyticsSpan: AnalyticsSpan.Year,
          reportFromLocalDate: localDate('2026-01-01'),
          reportToLocalDate: localDate('2026-12-31'),
        }),
      ),
    ).toBe(AnalyticsSpan.Month);
  });

  it('highlights the bucket holding today while the period runs, the last one once it is past', () => {
    const report = analyticsReportFixture();
    const points = report.reportSeries;
    // The fixture month is September 2026, a point a day.
    expect(C.latestBucketOf(report, localDate('2026-09-15'))).toBe(
      points.findIndex((p) => p.localDate === '2026-09-15'),
    );
    expect(C.latestBucketOf(report, localDate('2026-11-09'))).toBe(
      points.length - 1,
    );
    expect(
      C.latestBucketOf(analyticsReportFixture({ reportSeries: [] }), TODAY),
    ).toBeNull();
  });

  it('sums the time bar’s six parts as the rostered time so far, and shares the tips over the takings', () => {
    const report = analyticsReportFixture();
    expect(C.rosteredSoFarOf(report)).toBe(
      report.reportBarWorkedMinutes +
        report.reportBarNoShowMinutes +
        report.reportBarUnmarkedMinutes +
        report.reportBarBlockedMinutes +
        report.reportBarUnsoldMinutes +
        report.reportBarOtherMinutes,
    );
    expect(C.tipsShareOf(report)).toBeCloseTo(
      report.reportTipsCents / report.reportTakingsCents,
    );
    expect(
      C.tipsShareOf(
        analyticsReportFixture({ reportTakingsCents: 0 as PriceCents }),
      ),
    ).toBeNull();
  });
});

describe('AnalyticsCarouselSystem.moneyTicksOf — a money chart’s round amounts', () => {
  it('steps 1, 2 or 5 × a power of ten up to the first at or over the top', () => {
    // 136,50 € → steps of 50 €: 50, 100, 150.
    expect(C.moneyTicksOf([4300, null, 13650])).toEqual([5000, 10000, 15000]);
    // 35 € → steps of 20 €: 20, 40.
    expect(C.moneyTicksOf([3500])).toEqual([2000, 4000]);
    // Exactly on a step: it is the last rule.
    expect(C.moneyTicksOf([6000])).toEqual([2000, 4000, 6000]);
    // Never finer than 1 €.
    expect(C.moneyTicksOf([150])).toEqual([100, 200]);
  });

  it('rules nothing when nothing above zero is drawn, and is pure', () => {
    expect(C.moneyTicksOf([])).toEqual([]);
    expect(C.moneyTicksOf([0, null])).toEqual([]);
    const values = deepFreeze([1200, 900]);
    expect(C.moneyTicksOf(values)).toEqual(C.moneyTicksOf(values));
  });
});

describe('AnalyticsCarouselSystem — the locations compared', () => {
  const day = (d: string): AnalyticsReport.SeriesPoint => ({
    localDate: localDate(d),
    takingsCents: 0 as PriceCents,
    tipsCents: 0 as PriceCents,
    serviceTakings: [],
    comparisonTakingsCents: null,
  });
  const SERIES = [day('2026-11-08'), day('2026-11-09'), day('2026-11-10')];
  const row = (
    locationId: string,
    seriesCents: readonly number[],
  ): AnalyticsReport.LocationFigures => ({
    ...C.locationFiguresOf(
      LocationId.of(locationId),
      analyticsReportFixture({ reportSeries: SERIES }),
    ),
    seriesCents: seriesCents as readonly PriceCents[],
  });

  it('projects a location’s own report into its row: takings, pace pair, occupancy, served, new, rates and series', () => {
    const report = deepFreeze(analyticsReportFixture());
    const figures = C.locationFiguresOf(LocationId.of('loc-center'), report);
    expect(figures).toEqual({
      locationId: 'loc-center',
      takingsCents: report.reportTakingsCents,
      tipsCents: report.reportTipsCents,
      heroCurrentCents: report.reportHeroCurrentCents,
      heroPreviousCents: report.reportHeroPreviousCents,
      workedMinutes: report.reportWorkedMinutes,
      occupancy: C.occupancyOf(report),
      servedCount: C.servedOf(report),
      newClientCount: report.reportNewClientCount,
      rebookedRate: report.reportRebookedRate,
      noShowRate: report.reportNoShowRate,
      seriesCents: report.reportSeries.map((p) => p.takingsCents),
    });
  });

  it('runs each location’s total up to the bucket holding today, in the rows’ order', () => {
    const report = deepFreeze(
      analyticsReportFixture({
        reportSeries: SERIES,
        reportLocations: [row('a', [100, 200, 900]), row('b', [0, 50, 900])],
      }),
    );
    const paces = C.locationPacesOf(report, localDate('2026-11-09'));
    expect(paces).toEqual([
      [100, 300],
      [0, 50],
    ]);
    expect(C.locationPacesOf(report, localDate('2026-11-09'))).toEqual(paces);
    expect(
      C.locationPacesOf(
        analyticsReportFixture({ reportSeries: SERIES }),
        localDate('2026-11-09'),
      ),
    ).toEqual([]);
  });
});

describe('AnalyticsCarouselSystem.paceOf — the takings card’s running totals', () => {
  const point = (
    day: string,
    takings: number,
    comparison: number | null,
  ): AnalyticsReport.SeriesPoint => ({
    localDate: localDate(day),
    takingsCents: takings as PriceCents,
    tipsCents: 0 as PriceCents,
    serviceTakings: [],
    comparisonTakingsCents: comparison as PriceCents | null,
  });
  const report = (points: readonly AnalyticsReport.SeriesPoint[]) =>
    deepFreeze(analyticsReportFixture({ reportSeries: points }));

  it('runs the total up to the bucket holding today, the previous period over every bucket', () => {
    const pace = C.paceOf(
      report([
        point('2026-11-07', 1000, 500),
        point('2026-11-08', 0, 700),
        point('2026-11-09', 2500, 0),
        point('2026-11-10', 0, 900),
      ]),
      localDate('2026-11-09'),
    );
    expect(pace.current).toEqual([1000, 1000, 3500]);
    expect(pace.previous).toEqual([500, 1200, 1200, 2100]);
    expect(pace.slots).toBe(4);
    // Last month by this day — the bucket holding today.
    expect(pace.previousSoFar).toBe(1200);
  });

  it('runs a past period to its end; the comparison stops where a shorter previous period does, and is absent without a first', () => {
    const past = C.paceOf(
      report([point('2026-10-30', 400, 100), point('2026-10-31', 600, 300)]),
      localDate('2026-11-09'),
    );
    expect(past.current).toEqual([400, 1000]);
    expect(past.previousSoFar).toBe(400);
    // October against September: the 31st has no counterpart.
    const shorter = C.paceOf(
      report([point('2026-10-30', 400, 100), point('2026-10-31', 600, null)]),
      localDate('2026-11-09'),
    );
    expect(shorter.previous).toEqual([100]);
    expect(shorter.previousSoFar).toBe(100);
    const lone = C.paceOf(
      report([point('2026-10-30', 400, null), point('2026-10-31', 600, 300)]),
      localDate('2026-11-09'),
    );
    expect(lone.previous).toBeNull();
    expect(lone.previousSoFar).toBeNull();
    expect(C.paceOf(report([]), localDate('2026-11-09'))).toEqual({
      current: [],
      previous: null,
      slots: 0,
      previousSoFar: null,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = report([point('2026-11-08', 300, 200)]);
    expect(C.paceOf(input, TODAY)).toEqual(C.paceOf(input, TODAY));
  });
});

describe('AnalyticsCarouselSystem — occupancy, free time and clients served', () => {
  it('splits the free time at now: the unsold so far, the open still ahead — together the schedule’s free', () => {
    const report = analyticsReportFixture({
      reportUnsoldMinutes: 330 as MinuteCount,
      reportOpenMinutes: 1410 as MinuteCount,
    });
    expect(C.freeTimeOf(report)).toEqual({
      soFarMinutes: 330,
      aheadMinutes: 1410,
    });
  });

  it('scales the heatmap to its busiest hour — each cell’s occupancy over the peak’s, 0 … 1; all zero with nothing worked', () => {
    const cell = (worked: number, rostered: number) => ({
      weekday: 1 as AnalyticsReport.HourCell['weekday'],
      hour: 9 as AnalyticsReport.HourCell['hour'],
      workedMinutes: worked as MinuteCount,
      rosteredMinutes: rostered as MinuteCount,
    });
    // 3 % and 6 % of the hour worked: the 6 % is the grid's top.
    const quiet = analyticsReportFixture({
      reportHourGrid: [cell(3, 100), cell(6, 100), cell(0, 100), cell(0, 0)],
    });
    expect(C.busyStrengthsOf(quiet)).toEqual([0.5, 1, 0, 0]);
    const idle = analyticsReportFixture({
      reportHourGrid: [cell(0, 60), cell(0, 60)],
    });
    expect(C.busyStrengthsOf(idle)).toEqual([0, 0]);
  });

  it('measures occupancy as worked over the rostered time so far, capped at 1, none with nothing rostered', () => {
    const report = analyticsReportFixture();
    const rostered = C.rosteredSoFarOf(report);
    expect(C.occupancyOf(report)).toBeCloseTo(
      report.reportWorkedMinutes / rostered,
    );
    const empty = analyticsReportFixture({
      reportBarWorkedMinutes: 0 as MinuteCount,
      reportBarNoShowMinutes: 0 as MinuteCount,
      reportBarUnmarkedMinutes: 0 as MinuteCount,
      reportBarBlockedMinutes: 0 as MinuteCount,
      reportBarUnsoldMinutes: 0 as MinuteCount,
      reportBarOtherMinutes: 0 as MinuteCount,
    });
    expect(C.occupancyOf(empty)).toBeNull();
  });

  it('sums the day rows’ free time so far (the unsold) by weekday, Monday first, naming the emptiest; none on rows per month', () => {
    const base = analyticsReportFixture();
    const row = (day: string, unsold: number, open: number) => ({
      ...(base.reportDayRows[0] as AnalyticsReport['reportDayRows'][number]),
      localDate: localDate(day),
      dayUnsoldMinutes: unsold as MinuteCount,
      dayOpenMinutes: open as MinuteCount,
    });
    const week = C.freeWeekOf(
      analyticsReportFixture({
        reportDayRows: [
          // Monday 7 Sep twice (two barbers), Wednesday 9 Sep; the open
          // minutes are still ahead and stay out of the week's bars.
          row('2026-09-07', 60, 0),
          row('2026-09-07', 30, 30),
          row('2026-09-09', 15, 45),
        ],
      }),
    );
    expect(week?.minutes).toEqual([90, 0, 15, 0, 0, 0, 0]);
    expect(week?.emptiest).toBe(1);
    expect(
      C.freeWeekOf(analyticsReportFixture({ reportDayRows: [] }))?.emptiest,
    ).toBeNull();
    const year = analyticsReportFixture({
      reportAnalyticsSpan: AnalyticsSpan.Year,
      reportFromLocalDate: localDate('2026-01-01'),
      reportToLocalDate: localDate('2026-12-31'),
    });
    expect(C.freeWeekOf(year)).toBeNull();
  });

  it('counts the clients served as the worked seats', () => {
    const report = analyticsReportFixture({
      reportNoShowBase: 11,
      reportNoShowCount: 2,
    });
    expect(C.servedOf(report)).toBe(9);
  });
});
