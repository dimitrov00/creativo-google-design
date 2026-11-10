import { describe, expect, it } from 'vitest';
import { AnalyticsPeriod, AnalyticsSpan } from '@core/components';
import { LocationId, MinuteCount } from '@core/primitives';
import { AnalyticsCarouselSystem, StaffAnalyticsSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  analyticsReportFixture,
  deepFreeze,
  localDate,
  locationsReportFixture,
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
    scopeMenu: null,
    scopeBarberIds: [],
    scopeBarberId: null,
    scopeLocationIds: [],
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
    shapeReport: report,
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

  it('the scope menu: «Екип» is a filter row — its value under it, no pick — its submenu «Целият екип» alone first, then a box per barber, the admin’s own first; «all» and the boxes either/or', () => {
    const menu = StaffAnalyticsSystem.scopeMenuOf([IVAN, NIKO], NIKO, []);
    const shop = analyticsHomeVm(
      inputOf('bg', { report: shopReportFixture(), scopeMenu: menu }),
    );
    expect(shop.scope?.label).toBe('Салон');
    expect(shop.scope?.leading).toEqual({
      avatarSrc: null,
      name: 'Салон',
      icon: 'location.shop',
    });
    // One shop: no shops' row — the team's alone, a filter: no pick.
    expect(
      shop.scope?.options.map((o) => [
        o.id,
        o.label,
        o.description,
        o.selected,
        o.icon,
      ]),
    ).toEqual([['team', 'Екип', 'Всички', undefined, 'nav.team']]);
    const team = shop.scope?.options[0];
    expect(team?.childrenTitle).toBe('Екип');
    expect(
      team?.children?.map((o) => [o.id, o.label, o.all, o.checked, o.testId]),
    ).toEqual([
      ['all', 'Целият екип', true, true, 'analytics-scope-team-all'],
      ['niko', 'Аз', undefined, false, 'analytics-scope-niko'],
      ['ivan', 'Иван Колев', undefined, false, 'analytics-scope-ivan'],
    ]);
    expect(shop.period.leading).toBeNull();

    // One barber ticked: the pill names them and leads with their face.
    const ivan = analyticsHomeVm(
      inputOf('bg', {
        scopeMenu: menu,
        scopeBarberIds: [IVAN],
        scopeBarberId: IVAN,
      }),
    );
    expect(ivan.scope?.label).toBe('Иван Колев');
    expect(ivan.scope?.leading).toEqual({
      avatarSrc: null,
      name: 'Иван Колев',
      icon: null,
    });
    const row = ivan.scope?.options[0];
    expect(row?.label).toBe('Екип');
    expect(row?.description).toBe('Иван Колев');
    expect(row?.children?.map((o) => o.checked)).toEqual([false, false, true]);
    expect(ivan.pages.at(-1)?.query.barber).toBe('ivan');

    // Two ticked: a count, no face, and no goal to set.
    const pair = analyticsHomeVm(
      inputOf('bg', { scopeMenu: menu, scopeBarberIds: [IVAN, NIKO] }),
    );
    expect(pair.scope?.label).toBe('2 бръснари');
    // The row's value names them, in the menu's order.
    expect(pair.scope?.options[0]?.description).toBe('Аз, Иван Колев');
    expect(pair.scope?.leading?.icon).toBe('location.shop');
    expect(pair.pages.at(-1)?.query.barber).toBe('ivan,niko');
    expect(pair.tools.map((tool) => tool.tool)).not.toContain(
      AnalyticsTool.Goal,
    );
  });

  it('names the shop «Всички салони» when its figures span several locations', () => {
    const menu = StaffAnalyticsSystem.scopeMenuOf([IVAN, NIKO], NIKO, []);
    expect(
      analyticsHomeVm(inputOf('bg', { scopeMenu: menu, shopCount: 2 })).scope
        ?.label,
    ).toBe('Всички салони');
    expect(
      analyticsHomeVm(inputOf('en', { scopeMenu: menu, shopCount: 3 })).scope
        ?.label,
    ).toBe('All shops');
    expect(
      analyticsHomeVm(inputOf('en', { scopeMenu: menu })).scope?.label,
    ).toBe('Shop');
  });

  it('with two or more shops: «Салони» first, a filter row beside «Екип»; its submenu «Всички салони» alone, then a box per shop; ticked shops and barbers name the pill together (ADR 2026-11-09)', () => {
    const centre = LocationId.of('loc-centre');
    const mladost = LocationId.of('loc-mladost');
    const menu = StaffAnalyticsSystem.scopeMenuOf([IVAN], null, [
      centre,
      mladost,
    ]);
    const all = analyticsHomeVm(
      inputOf('bg', { scopeMenu: menu, shopCount: 2 }),
    );
    expect(
      all.scope?.options.map((o) => [o.id, o.label, o.description, o.testId]),
    ).toEqual([
      ['locations', 'Салони', 'Всички', 'analytics-scope-shop'],
      ['team', 'Екип', 'Всички', 'analytics-scope-team'],
    ]);
    const shops = all.scope?.options[0];
    expect(shops?.childrenTitle).toBe('Салони');
    expect(
      shops?.children?.map((o) => [o.id, o.label, o.icon, o.checked, o.testId]),
    ).toEqual([
      [
        'all',
        'Всички салони',
        'location.shop',
        true,
        'analytics-scope-locations-all',
      ],
      [
        centre,
        'Център',
        'location.shop',
        false,
        'analytics-scope-location-loc-centre',
      ],
      [
        mladost,
        'Младост',
        'location.shop',
        false,
        'analytics-scope-location-loc-mladost',
      ],
    ]);

    const atMladost = analyticsHomeVm(
      inputOf('bg', {
        scopeMenu: menu,
        shopCount: 2,
        scopeLocationIds: [mladost],
      }),
    );
    expect(atMladost.scope?.label).toBe('Младост');
    expect(atMladost.scope?.options[0]?.description).toBe('Младост');
    expect(
      atMladost.scope?.options[0]?.children?.map((o) => o.checked),
    ).toEqual([false, false, true]);
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

    // A barber's work at a shop: the two joined by a dot.
    const ivanThere = analyticsHomeVm(
      inputOf('bg', {
        scopeMenu: menu,
        shopCount: 2,
        scopeLocationIds: [centre],
        scopeBarberIds: [IVAN],
        scopeBarberId: IVAN,
      }),
    );
    expect(ivanThere.scope?.label).toBe('Център · Иван Колев');
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
    expect(cards.map((c) => [c.card, c.screen, c.title, c.value])).toEqual([
      ['takings', 'takings', 'Оборот', nbsp('45,50 €')],
      ['time', 'time', 'Работно време', '8 ч'],
      // The free time so far (the unsold), beside the time so far.
      ['free', 'time', 'Свободно време', '3 ч 20 мин'],
      ['tips', 'tips', 'Бакшиши', nbsp('5,00 €')],
      ['clients', 'rebooked', 'Клиенти', '2'],
    ]);
    const [takings, time, free, tips, clients] = cards;
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
    // How full the roster was, as a ring and a sentence.
    expect(time?.ring?.value).toBe(480);
    expect(time?.detail).toBe(`55% от 15 ч по график`);
    // What is still open to book reads under the figure while there is any.
    expect(free?.detail).toBe('още 50 мин свободни');
    expect(free?.spark?.values).toHaveLength(7);
    expect(free?.spark?.labels).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
    // A period with nothing left to book names its emptiest weekday.
    const done = analyticsReportFixture({
      reportOpenMinutes: 0 as MinuteCount,
    });
    const closed = analyticsHomeVm(
      inputOf('bg', {
        report: done,
        pageReports: PAGES.map((_, i) =>
          i === PAGES.length - 1 ? done : null,
        ),
      }),
    )
      .pages.at(-1)
      ?.cards?.find((c) => c.card === 'free');
    expect(closed?.value).toBe('3 ч 20 мин');
    expect(closed?.detail).toBe('най-свободно: вт');
    expect(tips?.detail).toBe('11% от оборота');
    // Who came of everyone booked, and who did not.
    // The new clients beside those who did not come.
    expect(clients?.detail).toBe('1 нов · 1 не дойде');
    expect(clients?.bar).toMatchObject({ value: 2, max: 3 });
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

  it('carries the salons compared on the shop’s page — each one’s takings as a bar in its own tone — and none without the comparison', () => {
    const report = deepFreeze(locationsReportFixture());
    const vm = analyticsHomeVm(
      inputOf('bg', {
        report,
        pageReports: PAGES.map((_, i) =>
          i === PAGES.length - 1 ? report : null,
        ),
      }),
    );
    const locations = vm.pages.at(-1)?.locations;
    expect(locations?.title).toBe('Салони');
    expect(
      locations?.rows.map((r) => [r.name, r.value, r.share, r.tone, r.detail]),
    ).toEqual([
      ['Център', nbsp('28,00 €'), 1, 0, '72% заетост · 14 клиента · 3 нови'],
      ['Младост', nbsp('17,50 €'), 0.625, 1, '40% заетост · 1 клиент · 1 нов'],
    ]);
    expect(locations?.testId).toBe('analytics-card-locations');
    expect(analyticsHomeVm(inputOf('bg')).pages.at(-1)?.locations).toBeNull();
  });

  it('draws a loading page’s bones in the shape the scope’s last report has — a row per barber and per salon — even with no page loaded', () => {
    const shop = deepFreeze(locationsReportFixture());
    const swiped = analyticsHomeVm(
      inputOf('bg', {
        // Swiped away from every loaded page: the screen's report is out
        // and the carousel holds none, the scope's last one stays.
        report: null,
        pageReports: PAGES.map(() => null),
        shapeReport: shop,
      }),
    );
    expect(swiped.pages[0]?.cards).toBeNull();
    expect(swiped.pages[0]?.bones).toEqual({
      teamRows: shop.reportBarbers.map((_, i) => i),
      locationRows: [0, 1],
    });
    // A barber's own report has no team card and no salons: tiles alone.
    const own = deepFreeze(analyticsReportFixture());
    expect(
      analyticsHomeVm(
        inputOf('bg', {
          report: null,
          pageReports: PAGES.map(() => null),
          shapeReport: own,
        }),
      ).pages[0]?.bones,
    ).toEqual({ teamRows: [], locationRows: [] });
    // The first load knows no shape yet.
    expect(
      analyticsHomeVm(
        inputOf('bg', {
          report: null,
          pageReports: PAGES.map(() => null),
          shapeReport: null,
        }),
      ).pages[0]?.bones,
    ).toEqual({ teamRows: [], locationRows: [] });
  });

  it('under the carousel: the days ahead, and the tools — the goal, then the export', () => {
    const vm = analyticsHomeVm(inputOf('bg'));
    expect(vm.ahead?.title).toBe('Предстои');
    // What the open hours are free OF: one barber's working time ahead…
    expect(vm.ahead?.detail).toBe('свободни от 37 ч работно време за 7 дни');
    // …and, for several barbers, whose hours add up.
    const team = analyticsHomeVm(
      inputOf('bg', {
        report: analyticsReportFixture({ reportAheadBarberCount: 3 }),
      }),
    );
    expect(team.ahead?.detail).toBe(
      'свободни от 37 ч работно време на 3 бръснари за 7 дни',
    );
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
      'Free time',
      'Tips',
      'Clients',
    ]);
  });

  it('is pure — the reports it reads are left as they were', () => {
    const input = inputOf('bg');
    expect(analyticsHomeVm(input)).toEqual(analyticsHomeVm(input));
  });
});
