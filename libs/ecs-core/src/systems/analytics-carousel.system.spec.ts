import { describe, expect, it } from 'vitest';
import {
  AnalyticsPeriod,
  AnalyticsRangePreset,
  AnalyticsSpan,
} from '@core/components';
import { analyticsReportFixture, deepFreeze, localDate } from '@core/testing';
import type { PriceCents } from '@core/primitives';
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

describe('AnalyticsCarouselSystem.tipsSeriesOf — tips per bucket', () => {
  it('sums each day row’s tips into the bucket its day falls in', () => {
    const report = analyticsReportFixture();
    const tips = C.tipsSeriesOf(report);
    expect(tips).toHaveLength(report.reportSeries.length);
    const index14 = report.reportSeries.findIndex(
      (p) => p.localDate === '2026-09-14',
    );
    // The fixture's two day rows (14 and 15 Sep) carry 3,00 € of tips each.
    expect(tips?.[index14]).toBe(300);
    expect(tips?.[index14 + 1]).toBe(300);
    expect(tips?.reduce((a, b) => a + b, 0)).toBe(600);
  });

  it('has none for a long range whose rows are per month against weekly buckets', () => {
    expect(
      C.tipsSeriesOf(
        analyticsReportFixture({
          reportAnalyticsSpan: AnalyticsSpan.Custom,
          reportFromLocalDate: localDate('2026-01-01'),
          reportToLocalDate: localDate('2026-09-30'),
        }),
      ),
    ).toBeNull();
  });
});
