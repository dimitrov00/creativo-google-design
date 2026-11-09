import { describe, expect, it } from 'vitest';
import { AnalyticsPeriod, AnalyticsSpan } from '@core/components';
import { AnalyticsCarouselSystem } from '@core/systems';
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
  type AnalyticsHomeInput,
  analyticsHomeVm,
  pageLabelOf,
} from './analytics-home.presenter';
import {
  AnalyticsGoalRefusal,
  AnalyticsGoalSave,
  AnalyticsLoad,
  AnalyticsRangeRefusal,
} from './analytics.vm';

const SEPTEMBER = AnalyticsPeriod.monthOf(FIXTURE_TODAY);
const PAGES = AnalyticsCarouselSystem.pagesOf(
  AnalyticsSpan.Month,
  FIXTURE_TODAY,
);

function inputOf(
  lang: 'bg' | 'en',
  overrides: Partial<AnalyticsHomeInput> = {},
): AnalyticsHomeInput {
  const report = deepFreeze(analyticsReportFixture());
  return {
    words: wordsOf(lang),
    zone: FIXTURE_TIME_ZONE,
    today: FIXTURE_TODAY,
    now: FIXTURE_NOW_UTC_MS,
    period: SEPTEMBER,
    analyticsLoad: AnalyticsLoad.Ready,
    report,
    refusal: null,
    scopeChoices: null,
    scopeBarberId: null,
    linkedBarberId: null,
    scopeGone: false,
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
    pages: PAGES,
    pageIndex: PAGES.length - 1,
    pageReports: PAGES.map((_, i) => (i === PAGES.length - 1 ? report : null)),
    ...overrides,
  };
}

describe('analyticsHomeVm — the Revolut home (staff-analytics-v3)', () => {
  it('words the period button by how far back the page sits, the rest by name', () => {
    const input = inputOf('bg');
    expect(pageLabelOf(SEPTEMBER, input)).toBe('Този месец');
    expect(
      pageLabelOf(AnalyticsPeriod.monthOf(localDate('2026-08-10')), input),
    ).toBe('Миналия месец');
    expect(
      pageLabelOf(AnalyticsPeriod.monthOf(localDate('2026-06-10')), input),
    ).toBe('Юни 2026\u202fг.');
    expect(pageLabelOf(AnalyticsPeriod.weekOf(FIXTURE_TODAY), input)).toBe(
      'Тази седмица',
    );
    expect(pageLabelOf(AnalyticsPeriod.dayOf(FIXTURE_TODAY), input)).toBe(
      'Днес',
    );
    expect(
      pageLabelOf(AnalyticsPeriod.dayOf(localDate('2026-09-27')), input),
    ).toBe('Вчера');
    expect(pageLabelOf(AnalyticsPeriod.yearOf(FIXTURE_TODAY), input)).toBe(
      'Тази година',
    );
    expect(
      pageLabelOf(
        AnalyticsPeriod.monthOf(localDate('2026-08-10')),
        inputOf('en'),
      ),
    ).toBe('Last month');
  });

  it('offers the grain in the period menu, the span on screen chosen; no scope menu for a barber', () => {
    const vm = analyticsHomeVm(inputOf('bg'));
    expect(vm.period.label).toBe('Този месец');
    expect(vm.period.options.map((o) => [o.id, o.label])).toEqual([
      ['DAY', 'Дневно'],
      ['WEEK', 'Седмично'],
      ['MONTH', 'Месечно'],
      ['YEAR', 'Годишно'],
    ]);
    expect(vm.period.selected).toBe('MONTH');
    expect(vm.scope).toBeNull();
  });

  it('words a page’s five cards from its report — the figure, the change, the line under it and its graph', () => {
    const vm = analyticsHomeVm(inputOf('bg'));
    const page = vm.pages.at(-1);
    expect(page?.label).toBe('Този месец');
    expect(page?.query).toEqual({
      span: 'MONTH',
      from: '2026-09-01',
      to: null,
      barber: null,
    });
    const cards = page?.cards ?? [];
    expect(cards.map((c) => [c.card, c.title, c.value])).toEqual([
      ['takings', 'Оборот', nbsp('45,50 €')],
      ['time', 'Работно време', '8 ч'],
      ['tips', 'Бакшиши', nbsp('5,00 €')],
      ['rebooked', 'Презаписали', '1 от 2'],
      ['no-shows', 'Неявили се', '1'],
    ]);
    const [takings, time, tips, rebooked, noShows] = cards;
    expect(takings?.delta).toBe('+30%');
    expect(takings?.trend).toBe('up');
    expect(takings?.detail).toBe(`средно ${nbsp('1,52 €')} на ден`);
    expect(takings?.spark?.values).toHaveLength(30);
    expect(takings?.spark?.highlight).toBe(27);
    expect(takings?.wide).toBe(true);
    expect(time?.detail?.startsWith('от ')).toBe(true);
    expect(time?.bar?.value).toBe(480);
    expect(tips?.detail).toBe('11% от оборота');
    expect(rebooked?.detail).toBe('клиенти с нов час');
    expect(rebooked?.ring).toMatchObject({ value: 1, max: 2 });
    expect(noShows?.detail).toBe('от 3 посещения');
    expect(takings?.accessibleName).toBe(
      `Оборот, ${nbsp('45,50 €')}, +30%, средно ${nbsp('1,52 €')} на ден`,
    );
    // A page without its report draws bones.
    expect(vm.pages[0]?.cards).toBeNull();
  });

  it('carries the team on the shop’s page, each barber’s bar as long as their share of the best', () => {
    const report = deepFreeze(shopReportFixture());
    const vm = analyticsHomeVm(
      inputOf('bg', {
        report,
        pageReports: PAGES.map((_, i) =>
          i === PAGES.length - 1 ? report : null,
        ),
      }),
    );
    const team = vm.pages.at(-1)?.team;
    expect(team?.title).toBe('Екипът');
    expect(team?.rows.map((r) => [r.name, r.value, r.share, r.tone])).toEqual([
      ['Иван Колев', nbsp('28,00 €'), 1, 0],
      ['Нико Петров', nbsp('17,50 €'), 0.625, 1],
    ]);
  });

  it('under the carousel: the days ahead, and the tools — the goal, then the export', () => {
    const vm = analyticsHomeVm(inputOf('bg'));
    expect(vm.ahead?.title).toBe('Предстои');
    expect(vm.ahead?.detail).toBe('свободни в следващите 7 дни');
    expect(vm.ahead?.spark.values).toHaveLength(7);
    expect(vm.tools.map((t) => [t.tool, t.title, t.detail])).toEqual([
      ['GOAL', 'Задай цел', 'Задай оборот за месеца'],
      ['EXPORT', 'Експорт', 'Дните и услугите като CSV'],
    ]);
  });

  it('a refused account has no goal, no days ahead and no tools', () => {
    const vm = analyticsHomeVm(
      inputOf('bg', {
        analyticsLoad: AnalyticsLoad.Refused,
        refusal: 'Нямаш достъп до тези анализи.',
      }),
    );
    expect(vm.blocked?.text).toBe('Нямаш достъп до тези анализи.');
    expect(vm.goal).toBeNull();
    expect(vm.ahead).toBeNull();
    expect(vm.tools).toEqual([]);
  });

  it('in English', () => {
    const vm = analyticsHomeVm(inputOf('en'));
    expect(vm.period.label).toBe('This month');
    expect(vm.pages.at(-1)?.cards?.map((c) => c.title)).toEqual([
      'Takings',
      'Working time',
      'Tips',
      'Rebooked',
      'No-shows',
    ]);
  });

  it('is pure — the reports it reads are left as they were', () => {
    const input = inputOf('bg');
    expect(analyticsHomeVm(input)).toEqual(analyticsHomeVm(input));
  });
});
