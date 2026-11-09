import { describe, expect, it } from 'vitest';
import { AnalyticsPeriod } from '@core/components';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  analyticsReportFixture,
  deepFreeze,
  localDate,
  shopReportFixture,
} from '@core/testing';
import { NAMES, nbsp, wordsOf } from '../testing/analytics.fixtures';
import {
  type AnalyticsCardInput,
  analyticsCardVm,
} from './analytics-card.presenter';
import { AnalyticsChartView } from './analytics-card.vm';
import { AnalyticsCard } from './analytics-home.vm';
import {
  AnalyticsGoalRefusal,
  AnalyticsGoalSave,
  AnalyticsLoad,
  AnalyticsRangeRefusal,
} from './analytics.vm';

function inputOf(
  card: AnalyticsCard,
  overrides: Partial<AnalyticsCardInput> = {},
  lang: 'bg' | 'en' = 'bg',
): AnalyticsCardInput {
  return {
    words: wordsOf(lang),
    zone: FIXTURE_TIME_ZONE,
    today: FIXTURE_TODAY,
    now: FIXTURE_NOW_UTC_MS,
    period: AnalyticsPeriod.monthOf(FIXTURE_TODAY),
    analyticsLoad: AnalyticsLoad.Ready,
    report: deepFreeze(analyticsReportFixture()),
    refusal: null,
    scopeChoices: null,
    scopeBarberId: null,
    linkedBarberId: null,
    scopeGone: false,
    shopCount: 1,
    scheduleBarberId: null,
    rangeCheck: {
      rangeRefusal: AnalyticsRangeRefusal.Incomplete,
      fromLocalDate: null,
      toLocalDate: null,
    },
    goalCheck: {
      goalRefusal: AnalyticsGoalRefusal.Incomplete,
      goalLowCents: null,
      goalHighCents: null,
    },
    goalSave: AnalyticsGoalSave.Idle,
    names: NAMES,
    card,
    view: null,
    ...overrides,
  };
}

describe('analyticsCardVm — a card’s own screen (staff-analytics-v3)', () => {
  it('«Оборот»: the figure, its change and average over the range, three views, the line first', () => {
    const vm = analyticsCardVm(inputOf(AnalyticsCard.Takings));
    expect(vm.title).toBe('Оборот');
    expect(vm.value).toBe(nbsp('45,50 €'));
    expect(vm.delta).toBe('+30%');
    expect(vm.subline).toBe(`средно ${nbsp('1,52 €')} на ден · Този месец`);
    expect(vm.views.map((v) => [v.id, v.label, v.icon, v.iconOnly])).toEqual([
      ['LINE', 'Линия', 'chart.line', true],
      ['BARS', 'Стълбове', 'chart.bars', true],
      ['RING', 'Кръг', 'chart.ring', true],
    ]);
    expect(vm.view).toBe(AnalyticsChartView.Line);
    expect(vm.chart?.chartView).toBe('LINE');
    expect(vm.services).not.toBeNull();
    expect(vm.time).toBeNull();
  });

  it('draws the takings’ ring by service — the top one in the accent, the rest in the greys — the figure in its centre', () => {
    const vm = analyticsCardVm(
      inputOf(AnalyticsCard.Takings, { view: AnalyticsChartView.Ring }),
    );
    const chart = vm.chart;
    if (chart?.chartView !== 'RING') throw new Error('not a ring');
    expect(chart.segments.map((s) => [s.label, s.part, s.valueText])).toEqual([
      ['Подстригване', 'worked', nbsp('28,00 €')],
      ['Брада', 'blocked', nbsp('17,50 €')],
    ]);
    expect(chart.centreCaption).toBe('Оборот');
    expect(chart.centreValue).toBe(nbsp('45,50 €'));
    expect(chart.centreDetail).toBe('Този месец');
  });

  it('the range row: the chips in words, 1М on the month, none on a day; «…» pressed on the sheet’s range', () => {
    const month = analyticsCardVm(inputOf(AnalyticsCard.Takings)).ranges;
    expect(month.segments.map((s) => s.label)).toEqual([
      '1С',
      '1М',
      '6М',
      '1Г',
      'МАКС',
    ]);
    expect(month.selected).toBe('MONTH');
    expect(month.customOn).toBe(false);
    const day = analyticsCardVm(
      inputOf(AnalyticsCard.Takings, {
        period: AnalyticsPeriod.dayOf(FIXTURE_TODAY),
      }),
    ).ranges;
    expect(day.selected).toBeNull();
    const custom = analyticsCardVm(
      inputOf(AnalyticsCard.Takings, {
        period: AnalyticsPeriod.customOf(
          localDate('2026-09-03'),
          FIXTURE_TODAY,
        ),
      }),
    ).ranges;
    expect(custom.customOn).toBe(true);
  });

  it('«Работно време»: bars first, its ring of the six parts in their paints', () => {
    const vm = analyticsCardVm(
      inputOf(AnalyticsCard.Time, { view: AnalyticsChartView.Ring }),
    );
    expect(vm.views.map((v) => v.id)).toEqual(['BARS', 'LINE', 'RING']);
    const chart = vm.chart;
    if (chart?.chartView !== 'RING') throw new Error('not a ring');
    expect(chart.segments.map((s) => s.part)).toEqual([
      'worked',
      'no-show',
      'unmarked',
      'blocked',
      'unsold',
      'other',
    ]);
    expect(vm.time).not.toBeNull();
    expect(vm.busy).not.toBeNull();
  });

  it('«Бакшиши»: tips per day as a line, and the ring of tips against the takings', () => {
    const line = analyticsCardVm(inputOf(AnalyticsCard.Tips)).chart;
    if (line?.chartView !== 'LINE') throw new Error('not a line');
    expect(line.points.reduce((sum, p) => sum + p.value, 0)).toBe(600);
    const ring = analyticsCardVm(
      inputOf(AnalyticsCard.Tips, { view: AnalyticsChartView.Ring }),
    ).chart;
    if (ring?.chartView !== 'RING') throw new Error('not a ring');
    expect(ring.segments.map((s) => s.label)).toEqual(['Бакшиши', 'Оборот']);
  });

  it('«Презаписали» and «Неявили се»: a ring of the count and the rest; on the shop also bars by barber', () => {
    const rebooked = analyticsCardVm(inputOf(AnalyticsCard.Rebooked));
    expect(rebooked.views).toEqual([]);
    const ring = rebooked.chart;
    if (ring?.chartView !== 'RING') throw new Error('not a ring');
    expect(ring.segments.map((s) => [s.label, s.value])).toEqual([
      ['Презаписали', 1],
      ['Без нов час', 1],
    ]);
    expect(rebooked.clients).not.toBeNull();
    const shop = analyticsCardVm(
      inputOf(AnalyticsCard.NoShows, {
        report: deepFreeze(shopReportFixture()),
        view: AnalyticsChartView.Bars,
      }),
    );
    expect(shop.views.map((v) => v.id)).toEqual(['RING', 'BARS']);
    const bars = shop.chart;
    if (bars?.chartView !== 'BARS') throw new Error('not bars');
    expect(bars.orientation).toBe('horizontal');
    expect(bars.bars.map((b) => b.label)).toEqual([
      'Иван Колев',
      'Нико Петров',
    ]);
  });

  it('«Екипът» on the shop: bars by barber first, a row per barber, the radars', () => {
    const vm = analyticsCardVm(
      inputOf(AnalyticsCard.Team, { report: deepFreeze(shopReportFixture()) }),
    );
    expect(vm.view).toBe(AnalyticsChartView.Bars);
    expect(vm.team?.map((row) => row.name)).toEqual([
      'Иван Колев',
      'Нико Петров',
    ]);
    expect(vm.radars?.radars).toHaveLength(2);
  });

  it('while the first report is out: no figure, no chart, the range alone under the title', () => {
    const vm = analyticsCardVm(
      inputOf(AnalyticsCard.Takings, {
        report: null,
        analyticsLoad: AnalyticsLoad.Loading,
      }),
    );
    expect(vm.value).toBeNull();
    expect(vm.chart).toBeNull();
    expect(vm.subline).toBe('Този месец');
  });

  it('in English', () => {
    const vm = analyticsCardVm(inputOf(AnalyticsCard.Takings, {}, 'en'));
    expect(vm.title).toBe('Takings');
    expect(vm.ranges.segments.map((s) => s.label)).toEqual([
      '1W',
      '1M',
      '6M',
      '1Y',
      'MAX',
    ]);
    expect(vm.subline).toContain('avg. per day · This month');
  });
});
