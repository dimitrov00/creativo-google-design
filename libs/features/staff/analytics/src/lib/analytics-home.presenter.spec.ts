import { describe, expect, it } from 'vitest';
import { AnalyticsPeriod, AnalyticsSpan } from '@core/components';
import { LocationId } from '@core/primitives';
import { AnalyticsCarouselSystem, StaffAnalyticsSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  analyticsReportFixture,
  deepFreeze,
  localDate,
  shopReportFixture,
} from '@core/testing';
import {
  IVAN,
  NAMES,
  NIKO,
  nbsp,
  wordsOf,
} from '../testing/analytics.fixtures';
import {
  type AnalyticsHomeInput,
  analyticsHomeVm,
  pageLabelOf,
} from './analytics-home.presenter';
import { AnalyticsTool } from './analytics-home.vm';
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
    scopeLocationId: null,
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

  it('leads the scope pill with a disc — the shop’s glyph, or the chosen barber’s face — and offers the shop as a glyph disc', () => {
    const choices = StaffAnalyticsSystem.scopeChoicesOf([IVAN, NIKO], NIKO, []);
    const shop = analyticsHomeVm(
      inputOf('bg', { report: shopReportFixture(), scopeChoices: choices }),
    );
    expect(shop.scope?.label).toBe('Салон');
    expect(shop.scope?.leading).toEqual({
      avatarSrc: null,
      name: 'Салон',
      icon: 'location.shop',
    });
    expect(shop.scope?.options.map((o) => [o.id, o.icon ?? null])).toEqual([
      ['shop', 'location.shop'],
      ['niko', null],
      ['ivan', null],
    ]);
    expect(shop.period.leading).toBeNull();
    // One shop: its section has no caption; the people's says «Екип».
    expect(shop.scope?.options.map((o) => o.group)).toEqual([
      '',
      'Екип',
      'Екип',
    ]);

    const ivan = analyticsHomeVm(
      inputOf('bg', { scopeChoices: choices, scopeBarberId: IVAN }),
    );
    expect(ivan.scope?.label).toBe('Иван Колев');
    expect(ivan.scope?.leading).toEqual({
      avatarSrc: null,
      name: 'Иван Колев',
      icon: null,
    });
  });

  it('names the shop scope «Всички салони» when its figures span several locations', () => {
    const choices = StaffAnalyticsSystem.scopeChoicesOf([IVAN, NIKO], NIKO, []);
    const bg = analyticsHomeVm(
      inputOf('bg', { scopeChoices: choices, shopCount: 2 }),
    );
    expect(bg.scope?.label).toBe('Всички салони');
    expect(bg.scope?.options[0]?.label).toBe('Всички салони');
    const en = analyticsHomeVm(
      inputOf('en', { scopeChoices: choices, shopCount: 3 }),
    );
    expect(en.scope?.label).toBe('All shops');
    expect(
      analyticsHomeVm(inputOf('en', { scopeChoices: choices })).scope?.label,
    ).toBe('Shop');
  });

  it('offers each location after «Всички салони», as a glyph disc; a chosen one names the pill and the cards’ query (ADR 2026-11-09)', () => {
    const centre = LocationId.of('loc-centre');
    const mladost = LocationId.of('loc-mladost');
    const choices = StaffAnalyticsSystem.scopeChoicesOf([IVAN], null, [
      centre,
      mladost,
    ]);
    const all = analyticsHomeVm(
      inputOf('bg', { scopeChoices: choices, shopCount: 2 }),
    );
    expect(
      all.scope?.options.map((o) => [o.id, o.label, o.icon ?? null, o.testId]),
    ).toEqual([
      ['shop', 'Всички салони', 'location.shop', 'analytics-scope-shop'],
      [
        'location:loc-centre',
        'Център',
        'location.shop',
        'analytics-scope-location-loc-centre',
      ],
      [
        'location:loc-mladost',
        'Младост',
        'location.shop',
        'analytics-scope-location-loc-mladost',
      ],
      ['ivan', 'Иван Колев', null, 'analytics-scope-ivan'],
    ]);
    // Two sections: the shops, captioned beside their locations, and the people.
    expect(all.scope?.options.map((o) => o.group)).toEqual([
      'Салони',
      'Салони',
      'Салони',
      'Екип',
    ]);
    const atMladost = analyticsHomeVm(
      inputOf('bg', {
        scopeChoices: choices,
        shopCount: 2,
        scopeLocationId: mladost,
      }),
    );
    expect(atMladost.scope?.label).toBe('Младост');
    expect(atMladost.scope?.selected).toBe('location:loc-mladost');
    expect(atMladost.scope?.leading).toEqual({
      avatarSrc: null,
      name: 'Младост',
      icon: 'location.shop',
    });
    expect(atMladost.pages.at(-1)?.query.location).toBe(mladost);
    // A location has no goal: no «Задай цел» among the tools.
    expect(atMladost.tools.map((tool) => tool.tool)).not.toContain(
      AnalyticsTool.Goal,
    );
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
      location: null,
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
    // The pace: the running total to today (the 28th) of the month's 30
    // days, against last month's over all 30, worded in the legend.
    expect(takings?.detail).toBeNull();
    expect(takings?.spark).toBeNull();
    expect(takings?.pace?.values).toHaveLength(28);
    expect(takings?.pace?.values.at(-1)).toBe(4550);
    expect(takings?.pace?.comparison).toHaveLength(30);
    expect(takings?.pace?.slots).toBe(30);
    expect(takings?.pace).toMatchObject({
      startLabel: '1.09',
      endLabel: '30.09',
      currentLabel: 'Този месец',
      currentValue: nbsp('45,50 €'),
      previousLabel: 'Миналия месец',
      previousValue: nbsp('35,00 €'),
    });
    expect(takings?.wide).toBe(true);
    expect(time?.detail?.startsWith('от ')).toBe(true);
    expect(time?.bar?.value).toBe(480);
    expect(tips?.detail).toBe('11% от оборота');
    expect(rebooked?.detail).toBe('клиенти с нов час');
    expect(rebooked?.ring).toMatchObject({ value: 1, max: 2 });
    expect(noShows?.detail).toBe('от 3 посещения');
    expect(takings?.accessibleName).toBe(
      `Оборот, ${nbsp('45,50 €')}, +30%, Този месец ${nbsp('45,50 €')}, Миналия месец ${nbsp('35,00 €')}`,
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
