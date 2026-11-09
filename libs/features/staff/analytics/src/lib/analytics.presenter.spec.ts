import { describe, expect, it } from 'vitest';
import {
  AnalyticsFigure,
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsSpan,
  GoalPaceTag,
  RadarBase,
} from '@core/components';
import {
  LocalDate,
  MinuteCount,
  type PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { StaffAnalyticsSystem } from '@core/systems';
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
  HAIRCUT,
  IVAN,
  NAMES,
  NIKO,
  nbsp,
  wordsOf,
} from '../testing/analytics.fixtures';
import {
  type AnalyticsDrillInput,
  type AnalyticsScreenInput,
  analyticsDrillVm,
  analyticsFreshnessInfoVm,
  analyticsInfoVm,
  analyticsVm,
} from './analytics.presenter';
import {
  AnalyticsGoalRefusal,
  AnalyticsGoalSave,
  AnalyticsLoad,
  AnalyticsRangeRefusal,
  AnalyticsTopic,
  DrillRows,
} from './analytics.vm';

const SEPTEMBER = AnalyticsPeriod.monthOf(FIXTURE_TODAY);
const cents = (raw: number) => raw as PriceCents;

function inputOf(
  lang: 'bg' | 'en',
  overrides: Partial<AnalyticsScreenInput> = {},
): AnalyticsScreenInput {
  return {
    words: wordsOf(lang),
    zone: FIXTURE_TIME_ZONE,
    today: FIXTURE_TODAY,
    now: FIXTURE_NOW_UTC_MS,
    period: SEPTEMBER,
    analyticsLoad: AnalyticsLoad.Ready,
    report: deepFreeze(analyticsReportFixture()),
    refusal: null,
    scopeMenu: null,
    scopeBarberIds: [],
    scopeBarberId: null,
    scopeLocationIds: [],
    linkedBarberId: IVAN,
    scopeGone: false,
    shopCount: 1,
    scheduleBarberId: IVAN,
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
    ...overrides,
  };
}

function bodyOf(input: AnalyticsScreenInput) {
  const body = analyticsVm(input).body;
  if (body === null) throw new Error('no body');
  return body;
}

describe('analyticsVm — a barber’s month, in Bulgarian', () => {
  const vm = analyticsVm(inputOf('bg'));
  const body = bodyOf(inputOf('bg'));

  it('words the head, the switcher and when the figures are from', () => {
    expect(vm.title).toBe('Анализи');
    expect(vm.backLabel).toBe('Към графика');
    expect(vm.freshness).toEqual({
      text: 'току-що',
      retry: false,
      info: 'Цифрите се изчисляват при отваряне от записаните дни',
      testId: 'analytics-status',
    });
    expect(vm.period.spans.map((span) => span.label)).toEqual([
      'Ден',
      'Седмица',
      'Месец',
      'Година',
    ]);
    expect(vm.period.selectedSpan).toBe('MONTH');
    expect(vm.period.label).toBe('Септември 2026\u202fг.');
    // The current month: back is offered, forward is not.
    expect(vm.period.previousEnabled).toBe(true);
    expect(vm.period.nextEnabled).toBe(false);
    expect(vm.placeholder).toBe(false);
    expect(vm.blocked).toBeNull();
  });

  it('words the hero: takings, the change chip, the tips on their own line', () => {
    expect(body.hero).toMatchObject({
      caption: 'Оборот',
      value: nbsp('45,50 €'),
      delta: '+30%',
      trend: 'up',
      comparison: 'спрямо предходния период',
      tipsLabel: 'Бакшиши',
      tipsValue: nbsp('5,00 €'),
      excluded: null,
    });
    expect(body.empty).toBeNull();
  });

  it('words every part of the time bar, and what is still ahead', () => {
    expect(
      body.time.segments.map((segment) => [segment.label, segment.value]),
    ).toEqual([
      ['Работа', '8 ч'],
      ['Неявили се', '1 ч'],
      ['Неотбелязани', '0 мин'],
      ['Блокирано', '2 ч'],
      ['Свободно', '3 ч 20 мин'],
      ['Друго', '20 мин'],
    ]);
    expect(body.time.segments[0]?.part).toBe('worked');
    expect(body.time.ahead).toBe(
      'Предстои: 1 ч 30 мин записани · 50 мин свободни',
    );
    expect(body.time.byDay).toBe('По дни');
  });

  it('words the open hours and leads to the emptiest day’s agenda, free time on', () => {
    expect(body.open).toMatchObject({
      title: 'Свободни часове',
      value: '6 ч 30 мин',
      caption: 'в следващите 7 дни',
      detail: 'Най-много: вторник, 29.09',
      link: { day: '2026-09-29', view: 'agenda', barber: IVAN, free: '1' },
    });
  });

  it('words the services as ranked bars — the name and the takings an hour, the takings and the count — each opening its seats', () => {
    expect(body.services.title).toBe('Услуги');
    expect(body.services.label).toBe('Услуги по оборот');
    expect(body.services.bars[0]).toEqual({
      label: 'Подстригване · 42,00\u00a0€ на час',
      parts: [{ part: 'worked', value: 2800 }],
      // The service's own colour — its place in the catalogue.
      tone: 0,
    });
    expect(body.services.valueText).toEqual([
      `${nbsp('28,00 €')} · 1 път`,
      `${nbsp('17,50 €')} · 1 път`,
    ]);
    expect(body.services.bars[1]?.label.startsWith('Брада')).toBe(true);
    expect(body.services.drills[0]).toEqual({
      analyticsFigure: AnalyticsFigure.Takings,
      serviceId: HAIRCUT,
    });
    expect(body.services.empty).toBeNull();
  });

  it('draws the takings line: a point per day, the comparison aligned by position, the average rule', () => {
    const series = body.series;
    if (series === null) throw new Error('no series on a month');
    expect(series.label).toBe('Оборот по дни');
    expect(series.points).toHaveLength(30);
    // A month numbers every seventh day along the axis.
    expect(series.points.map((point) => point.label).slice(0, 8)).toEqual([
      '1',
      '',
      '',
      '',
      '',
      '',
      '',
      '8',
    ]);
    expect(series.points[13]).toEqual({
      label: '',
      value: 2800,
      comparison: 3500,
    });
    expect(series.valueText[13]).toBe(nbsp('28,00 €'));
    expect(series.average).toBe(Math.round(4550 / 30));
    expect(series.averageText).toBe(`средно ${nbsp('1,52 €')}`);
    expect(series.comparisonLegend).toBe('предходен период');
  });

  it('draws a stacked bar per day of the six parts, in the legend’s order, its figure the parts together', () => {
    const bars = body.time.bars;
    expect(bars.label).toBe('Работното време по дни');
    expect(bars.bars).toHaveLength(30);
    expect(bars.bars[13]?.parts).toEqual([
      { part: 'worked', value: 270 },
      { part: 'no-show', value: 30 },
      { part: 'unmarked', value: 0 },
      { part: 'blocked', value: 60 },
      { part: 'unsold', value: 100 },
      { part: 'other', value: 10 },
    ]);
    expect(bars.valueText[13]).toBe('7 ч 50 мин');
    expect(bars.valueText[0]).toBe('0 мин');
  });

  it('draws when the chair is busy: the rostered weekdays by the rostered hours, each hour against the busiest', () => {
    const busy = body.busy;
    expect(busy?.title).toBe('Кога е заето');
    expect(busy?.label).toBe('Заетост по ден и час');
    expect(busy?.rows).toEqual(['пн', 'вт']);
    expect(busy?.columns).toEqual([
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
    ]);
    expect(busy?.cells).toHaveLength(18);
    // 30 of 60 minutes worked is the grid's busiest hour: full strength.
    expect(busy?.cells[0]).toEqual({ row: 0, column: 0, value: 1, max: 1 });
    expect(busy?.cells[17]).toEqual({ row: 1, column: 8, value: 0, max: 1 });
    // Two rostered days: under the base of seven, no verdict yet.
    expect(busy?.sentence).toBe(
      'Най-натовареният час се показва след 7 работни дни.',
    );
  });

  it('names the busiest and the emptiest hour once the report has them', () => {
    const busy = bodyOf(
      inputOf('bg', {
        report: deepFreeze({
          ...analyticsReportFixture(),
          reportBusiestWeekday: 2,
          reportBusiestHour: 10,
          reportEmptiestWeekday: 1,
          reportEmptiestHour: 17,
        }),
      }),
    ).busy;
    expect(busy?.sentence).toBe(
      'Най-натоварено: вт в 10:00 · най-спокойно: пн в 17:00',
    );
  });

  it('draws the open hours as seven bars from today, the emptiest day in the accent', () => {
    const bars = body.open.bars;
    expect(bars.label).toBe('Свободни часове по дни');
    expect(bars.bars.map((bar) => bar.label)).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
    expect(bars.bars[1]?.parts).toEqual([{ part: 'worked', value: 120 }]);
    expect(bars.highlightIndex).toBe(1);
    expect(bars.valueText).toEqual([
      '0 мин',
      '2 ч',
      '1 ч 30 мин',
      '1 ч',
      '1 ч',
      '30 мин',
      '30 мин',
    ]);
  });

  it('words the clients’ figures as counts under the base of 20, with the note', () => {
    expect(body.clients.rows.map((row) => [row.label, row.value])).toEqual([
      ['Презаписали', '1 от 2'],
      ['Неявили се', '1 от 3'],
      ['Късни откази', '1'],
    ]);
    expect(body.clients.note).toBe('Процентите се показват от 20 нагоре.');
    // The origins are the shop's alone; the heatmap is everyone's.
    expect(body.origins).toBeNull();
    expect(body.busy).not.toBeNull();
  });

  it('shows a rate from its base of 20', () => {
    const rated = bodyOf(
      inputOf('bg', {
        report: analyticsReportFixture({
          reportRebookedCount: 9,
          reportRebookedBase: 20,
          reportRebookedRate: 0.45,
          reportNoShowCount: 1,
          reportNoShowBase: 20,
          reportNoShowRate: 0.05,
        }),
      }),
    );
    expect(rated.clients.rows.map((row) => row.value)).toEqual([
      '45%',
      '5%',
      '1',
    ]);
    expect(rated.clients.note).toBeNull();
  });
});

describe('analyticsVm — the same month in English', () => {
  const vm = analyticsVm(inputOf('en'));
  const body = bodyOf(inputOf('en'));

  it('words every section in English', () => {
    expect(vm.title).toBe('Analytics');
    expect(vm.freshness?.text).toBe('just now');
    expect(vm.freshness?.info).toBe(
      'The figures are computed when you open the screen, from the stored days',
    );
    expect(vm.period.spans.map((span) => span.label)).toEqual([
      'Day',
      'Week',
      'Month',
      'Year',
    ]);
    expect(vm.period.label).toBe('September 2026');
    expect(body.hero).toMatchObject({
      caption: 'Takings',
      value: '€45.50',
      delta: '+30%',
      comparison: 'against the previous period',
      tipsLabel: 'Tips',
      tipsValue: '€5.00',
    });
    expect(body.time.segments.map((segment) => segment.label)).toEqual([
      'Worked',
      'No-shows',
      'Unmarked',
      'Blocked',
      'Free',
      'Other',
    ]);
    expect(body.time.ahead).toBe(
      'Still ahead: 1 h 30 min booked · 50 min open',
    );
    expect(body.open.detail).toBe('Most on Tuesday, 09/29');
    expect(body.services.bars[0]?.label).toBe('Подстригване · €42.00 an hour');
    expect(body.services.valueText[0]).toBe('€28.00 · 1 time');
    expect(body.series?.label).toBe('Takings by day');
    expect(body.series?.averageText).toBe('average €1.52');
    expect(body.series?.comparisonLegend).toBe('previous period');
    expect(body.time.bars.label).toBe('Working time by day');
    expect(body.busy?.title).toBe('When it is busy');
    expect(body.busy?.rows).toEqual(['Mon', 'Tue']);
    expect(body.busy?.sentence).toBe(
      'The busiest hour shows after 7 working days.',
    );
    expect(body.open.bars.label).toBe('Open hours by day');
    expect(body.clients.rows.map((row) => [row.label, row.value])).toEqual([
      ['Rebooked', '1 of 2'],
      ['No-shows', '1 of 3'],
      ['Late cancellations', '1'],
    ]);
    expect(body.clients.note).toBe('Rates show from 20 up.');
  });
});

describe('analyticsVm — the admin and the shop', () => {
  const choices = StaffAnalyticsSystem.scopeMenuOf([IVAN, NIKO], NIKO, []);

  it('draws the admin’s radars: one per barber in its tone, five axes on the shop’s base, the comparison on the same base, a tap to the scope', () => {
    const body = bodyOf(
      inputOf('bg', {
        report: shopReportFixture(),
        scopeMenu: choices,
        scheduleBarberId: null,
      }),
    );
    const radars = body.radars;
    expect(radars?.title).toBe('Как се справя всеки');
    expect(radars?.subtitle).toBe('спрямо най-добрия в салона');
    expect(radars?.missingText).toBe('малко данни');
    expect(radars?.radars.map((radar) => [radar.name, radar.tone])).toEqual([
      [NAMES.barberName(IVAN), 0],
      [NAMES.barberName(NIKO), 1],
    ]);
    const ivan = radars?.radars[0];
    expect(ivan?.barberId).toBe(IVAN);
    expect(ivan?.axes.map((axis) => axis.label)).toEqual([
      '€ на час',
      'Запълване',
      'Презаписване',
      'Бакшиши',
      'Надеждност',
    ]);
    expect(ivan?.axes.map((axis) => axis.value)).toEqual([
      100, 100, 100, 62.5, 96,
    ]);
    expect(ivan?.valueText).toEqual(['100', '100', '100', '63', '96']);
    expect(
      ivan?.axes.map((axis) =>
        axis.comparison === null ? null : Math.round(axis.comparison),
      ),
    ).toEqual([100, 90, 83, 60, 93]);
    expect(ivan?.accessibleName).toBe(`Отвори ${NAMES.barberName(IVAN)}`);
    expect(ivan?.testId).toBe('analytics-radar-ivan');
    const niko = radars?.radars[1];
    expect(niko?.axes.every((axis) => axis.comparison === null)).toBe(true);
    expect(radars?.comparisonLegend).toBe('предходен период');
  });

  it('words a missing axis, and a shop of one barber has the base’s word and no radar', () => {
    const report = shopReportFixture();
    const few = bodyOf(
      inputOf('bg', {
        report: deepFreeze({
          ...report,
          reportRadars: [
            {
              ...(report.reportRadars[0] as AnalyticsReport.RadarRow),
              tipsRate: null,
            },
          ],
          reportRadarBase: RadarBase.TooFewBarbers,
        }),
        scopeMenu: choices,
        scheduleBarberId: null,
      }),
    );
    expect(few.radars?.subtitle).toBe('твърде малко бръснари за сравнение');
    expect(few.radars?.radars[0]?.valueText[3]).toBe('малко данни');
    // A barber's own report carries none; nor does a shop's week.
    expect(bodyOf(inputOf('bg')).radars).toBeNull();
    const week = bodyOf(
      inputOf('bg', {
        report: deepFreeze({
          ...report,
          reportAnalyticsSpan: AnalyticsSpan.Week,
        }),
        scopeMenu: choices,
        scheduleBarberId: null,
      }),
    );
    expect(week.radars).toBeNull();
  });

  it('words the shop’s booking origins as one stacked bar with its rows; its services open nothing', () => {
    const body = bodyOf(
      inputOf('bg', {
        report: shopReportFixture(),
        scopeMenu: choices,
        scheduleBarberId: null,
      }),
    );
    expect(body.origins?.title).toBe('Откъде идват записванията');
    expect(body.origins?.label).toBe('Записвания по произход');
    expect(body.origins?.bars).toEqual([
      {
        label: '',
        parts: [
          { part: 'online', value: 1 },
          { part: 'staff', value: 1 },
          { part: 'unknown', value: 0 },
        ],
        tone: null,
      },
    ]);
    expect(
      body.origins?.rows.map((row) => [
        row.part,
        row.title,
        row.detail,
        row.value,
      ]),
    ).toEqual([
      ['online', 'Онлайн', '1 посещение', '50%'],
      ['staff', 'От салона', '1 посещение', '50%'],
      ['unknown', 'Неизвестно', '0 посещения', '0%'],
    ]);
    expect(body.services.drills.every((drill) => drill === null)).toBe(true);
    // The schedule opens on everyone.
    expect(body.open.link?.barber).toBeNull();
  });
});

describe('analyticsVm — the screen states', () => {
  it('first open, nothing cached: the placeholder layout and «Обновява се…»', () => {
    const vm = analyticsVm(
      inputOf('bg', { analyticsLoad: AnalyticsLoad.Loading, report: null }),
    );
    expect(vm.placeholder).toBe(true);
    expect(vm.body).toBeNull();
    expect(vm.freshness?.text).toBe('Обновява се…');
  });

  it('cached, being refreshed: the cached figures and their time', () => {
    const vm = analyticsVm(
      inputOf('bg', { analyticsLoad: AnalyticsLoad.Refreshing }),
    );
    expect(vm.placeholder).toBe(false);
    expect(vm.body).not.toBeNull();
    expect(vm.freshness?.text).toBe('току-що');
  });

  it('call failed, cache shown: the figures stay, «could not update» with retry', () => {
    const vm = analyticsVm(
      inputOf('bg', { analyticsLoad: AnalyticsLoad.Failed }),
    );
    expect(vm.freshness).toEqual({
      text: 'Не успяхме да обновим. Данните са към 09:00.',
      retry: true,
      info: 'Цифрите се изчисляват при отваряне от записаните дни',
      testId: 'analytics-status-failed',
    });
    expect(vm.body).not.toBeNull();
    expect(vm.blocked).toBeNull();
  });

  it('call failed, nothing cached: a message and retry, no figures', () => {
    const vm = analyticsVm(
      inputOf('en', { analyticsLoad: AnalyticsLoad.Failed, report: null }),
    );
    expect(vm.blocked).toEqual({
      text: 'The analytics did not load.',
      retry: true,
      testId: 'analytics-failed',
    });
    expect(vm.body).toBeNull();
    expect(vm.freshness).toBeNull();
    expect(vm.retryLabel).toBe('Try again');
  });

  it('a refusal: its words, no figures, no retry', () => {
    const refusal =
      'Профилът ти още не е свързан с бръснар. Помоли собственика да го свърже.';
    const vm = analyticsVm(
      inputOf('bg', {
        analyticsLoad: AnalyticsLoad.Refused,
        report: null,
        refusal,
      }),
    );
    expect(vm.blocked).toEqual({
      text: refusal,
      retry: false,
      testId: 'analytics-refused',
    });
    expect(vm.body).toBeNull();
    expect(vm.freshness).toBeNull();
  });

  it('a barber who no longer exists: the shop, and the reason in words', () => {
    const vm = analyticsVm(inputOf('bg', { scopeGone: true }));
    expect(vm.notice).toBe(
      'Този бръснар вече не съществува. Показваме целия салон.',
    );
  });

  it('an empty period: «no visits» with the rostered hours, or none', () => {
    const quiet = {
      reportWorkedMinutes: MinuteCount.ZERO,
      reportNoShowMinutes: MinuteCount.ZERO,
      reportBookedAheadMinutes: MinuteCount.ZERO,
      reportTakingsCents: cents(0),
      reportNoShowCount: 0,
      reportLateCancellationCount: 0,
    };
    expect(
      bodyOf(inputOf('bg', { report: analyticsReportFixture(quiet) })).empty,
    ).toEqual({
      title: 'Няма посещения за този период',
      detail: 'По график: 18 ч',
    });
    expect(
      bodyOf(
        inputOf('en', {
          report: analyticsReportFixture({
            ...quiet,
            reportRosteredMinutes: MinuteCount.ZERO,
          }),
        }),
      ).empty,
    ).toEqual({
      title: 'No visits in this period',
      detail: 'No working hours in this period.',
    });
  });

  it('the hero with no previous period, an equal one, or one of nothing', () => {
    const hero = (overrides: Partial<AnalyticsReport>, lang: 'bg' | 'en') =>
      bodyOf(inputOf(lang, { report: analyticsReportFixture(overrides) })).hero;
    expect(hero({ reportHeroPreviousCents: null }, 'bg')).toMatchObject({
      delta: null,
      trend: null,
      comparison: 'Още няма предходен период за сравнение',
    });
    expect(hero({ reportHeroPreviousCents: cents(4550) }, 'en')).toMatchObject({
      delta: null,
      comparison: 'the same as the previous period',
    });
    expect(hero({ reportHeroPreviousCents: cents(0) }, 'en')).toMatchObject({
      delta: null,
      comparison: 'from €0 in the previous period',
    });
    expect(
      hero(
        {
          reportHeroCurrentCents: cents(1000),
          reportHeroPreviousCents: cents(2000),
        },
        'bg',
      ),
    ).toMatchObject({ delta: '-50%', trend: 'down' });
    expect(hero({ reportExcludedVisitCount: 2 }, 'bg').excluded).toBe(
      '2 посещения без изчислима сметка не са включени',
    );
  });

  it('no open hours ahead: the card says so and leads nowhere', () => {
    const open = bodyOf(
      inputOf('bg', {
        report: analyticsReportFixture({
          reportBookableOpenMinutes: MinuteCount.ZERO,
          reportEmptiestLocalDate: null,
        }),
      }),
    ).open;
    expect(open.detail).toBe('Няма свободни часове в следващите 7 дни');
    expect(open.link).toBeNull();
  });

  it('a week reads as its two days', () => {
    const vm = analyticsVm(
      inputOf('bg', { period: AnalyticsPeriod.weekOf(FIXTURE_TODAY) }),
    );
    expect(vm.period.label).toBe('28.09 – 4.10');
    expect(vm.period.selectedSpan).toBe('WEEK');
  });

  it('a week’s charts name their days along the axis', () => {
    const week = AnalyticsPeriod.weekOf(FIXTURE_TODAY);
    const monday = localDate('2026-09-28');
    const report = analyticsReportFixture();
    const body = bodyOf(
      inputOf('bg', {
        period: week,
        report: deepFreeze({
          ...report,
          reportAnalyticsSpan: week.analyticsSpan,
          reportFromLocalDate: week.fromLocalDate,
          reportToLocalDate: week.toLocalDate,
          reportSeries: report.reportAheadDays.map((day) => ({
            localDate: day.localDate,
            takingsCents: cents(day.openMinutes * 10),
            tipsCents: cents(0),
            comparisonTakingsCents: null,
          })),
          reportTimeSeries: report.reportTimeSeries
            .slice(0, 7)
            .map((point, i) => ({
              ...point,
              localDate: LocalDate.addDays(monday, i),
            })),
        }),
      }),
    );
    expect(body.series?.points.map((point) => point.label)).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
    expect(body.time.bars.bars.map((bar) => bar.label)).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
  });
});

describe('analyticsVm — a DAY (staff-analytics-v2 PR 3)', () => {
  const TUESDAY = localDate('2026-09-15');
  const day = AnalyticsPeriod.dayOf(TUESDAY);
  /** The fixture month cut to one day: Tuesday the 15th, compared with Tuesday the 8th. */
  const dayReport = () => {
    const report = analyticsReportFixture();
    return deepFreeze({
      ...report,
      reportAnalyticsSpan: AnalyticsSpan.Day,
      reportFromLocalDate: TUESDAY,
      reportToLocalDate: TUESDAY,
      reportComparisonFromLocalDate: localDate('2026-09-08'),
      reportComparisonToLocalDate: localDate('2026-09-08'),
      reportSeries: report.reportSeries.slice(14, 15),
      reportTimeSeries: report.reportTimeSeries.slice(14, 15),
    });
  };
  const input = inputOf('bg', { period: day, report: dayReport() });
  const vm = analyticsVm(input);
  const body = bodyOf(input);

  it('offers the four spans, names the day, and the chip says what it is compared with', () => {
    expect(vm.period.spans.map((span) => span.label)).toEqual([
      'Ден',
      'Седмица',
      'Месец',
      'Година',
    ]);
    expect(vm.period.selectedSpan).toBe('DAY');
    expect(vm.period.label).toBe('вторник, 15.09');
    expect(vm.period.comparison).toEqual({
      text: 'спрямо предходния период',
      comparable: true,
      testId: 'analytics-comparison-chip',
    });
  });

  it('shows the hero and its delta alone — no line, no heatmap — and the day as one bar with no word', () => {
    expect(body.series).toBeNull();
    expect(body.busy).toBeNull();
    expect(body.time.bars.bars).toHaveLength(1);
    expect(body.time.bars.bars[0]?.label).toBe('');
    expect(body.time.bars.bars[0]?.parts[0]).toEqual({
      part: 'worked',
      value: 210,
    });
    expect(body.time.bars.valueText).toEqual(['6 ч 50 мин']);
    // The open-hours card and the services keep their charts.
    expect(body.open.bars.bars).toHaveLength(7);
    expect(body.services.bars).toHaveLength(2);
  });

  it('says there is no comparison when the comparison period starts before the reach', () => {
    const edge = AnalyticsPeriod.dayOf(localDate('2025-09-03'));
    const vm = analyticsVm(
      inputOf('bg', { period: edge, report: dayReport() }),
    );
    expect(AnalyticsPeriod.isComparable(edge, FIXTURE_TODAY)).toBe(false);
    expect(vm.period.comparison).toEqual({
      text: 'няма данни за сравнение',
      comparable: false,
      testId: 'analytics-comparison-chip',
    });
    const en = analyticsVm(
      inputOf('en', { period: edge, report: dayReport() }),
    );
    expect(en.period.comparison.text).toBe('no comparison data');
    expect(en.period.spans[0]?.label).toBe('Day');
  });
});

describe('analyticsVm — freshness, the report’s age against now', () => {
  /** The report computed at 09:00, read `minutes` later. */
  const readAfter = (minutes: number, lang: 'bg' | 'en' = 'bg') =>
    analyticsVm(
      inputOf(lang, {
        now: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, minutes * 60_000),
      }),
    ).freshness?.text;

  it('under a minute — and a negative age, a server clock ahead — is «току-що»', () => {
    expect(readAfter(0)).toBe('току-що');
    expect(
      analyticsVm(
        inputOf('bg', {
          now: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 59_999),
        }),
      ).freshness?.text,
    ).toBe('току-що');
    expect(readAfter(-5)).toBe('току-що');
    expect(readAfter(-5, 'en')).toBe('just now');
  });

  it('under an hour is a relative phrase, in both languages', () => {
    expect(readAfter(1)).toBe('Обновено преди 1 мин');
    expect(readAfter(5)).toBe('Обновено преди 5 мин');
    expect(readAfter(59)).toBe('Обновено преди 59 мин');
    expect(readAfter(5, 'en')).toBe('Updated 5 min. ago');
  });

  it('an hour or more on the same shop day is the time', () => {
    expect(readAfter(60)).toBe('Обновено в 09:00');
    expect(readAfter(6 * 60)).toBe('Обновено в 09:00');
    expect(readAfter(6 * 60, 'en')).toBe('Updated at 09:00 AM');
  });

  it('an earlier shop day is the date and the time', () => {
    const vm = analyticsVm(
      inputOf('bg', {
        report: analyticsReportFixture({
          reportComputedAtUtcMs: UtcEpochMs.plusDays(FIXTURE_NOW_UTC_MS, -1),
        }),
      }),
    );
    expect(vm.freshness?.text).toBe('Обновено на 27.09, 09:00');
  });

  it('the ⓘ names the screen and says how the figures come about', () => {
    expect(analyticsFreshnessInfoVm(wordsOf('bg'))).toEqual({
      title: 'Анализи',
      message: 'Цифрите се изчисляват при отваряне от записаните дни',
      closeLabel: 'Разбрах',
    });
  });
});

describe('analyticsInfoVm — every ⓘ in words', () => {
  it('names each topic and defines it, in both languages', () => {
    for (const lang of ['bg', 'en'] as const) {
      for (const topic of Object.values(AnalyticsTopic)) {
        const info = analyticsInfoVm(wordsOf(lang), topic);
        expect(info.title.length).toBeGreaterThan(0);
        expect(info.message.length).toBeGreaterThan(20);
      }
    }
    expect(analyticsInfoVm(wordsOf('bg'), AnalyticsTopic.Rebooked)).toEqual({
      title: 'Презаписали',
      message:
        'От посещенията с отработена услуга: колко са записали нов час от посещението („Запиши пак“) до края на следващия ден. Час, записан по-късно или отделно, не се брои.',
      closeLabel: 'Разбрах',
    });
    expect(analyticsVm(inputOf('en')).infoLabels[AnalyticsTopic.Takings]).toBe(
      'What “Takings” means',
    );
  });
});

describe('analyticsDrillVm — a figure’s rows and a footer equal to it', () => {
  function drillOf(
    lang: 'bg' | 'en',
    overrides: Partial<AnalyticsDrillInput> = {},
  ) {
    return analyticsDrillVm({
      words: wordsOf(lang),
      today: FIXTURE_TODAY,
      report: analyticsReportFixture(),
      drill: { analyticsFigure: AnalyticsFigure.Takings, serviceId: null },
      seatRowsHeld: true,
      names: NAMES,
      ...overrides,
    });
  }

  it('takings: the worked seats through the visits list, the footer the figure', () => {
    const drill = drillOf('bg');
    expect(drill.drillRows).toBe(DrillRows.Seats);
    expect(drill.title).toBe('Оборот');
    expect(drill.footerLabel).toBe('Общо');
    expect(drill.footerValue).toBe(nbsp('45,50 €'));
    expect(drill.sections).toHaveLength(1);
    expect(drill.sections[0]?.label).toBe('Септември 2026\u202fг.');
    const rows = drill.sections[0]?.rows ?? [];
    expect(rows.map((row) => [row.title, row.lines[0]?.text])).toEqual([
      ['Брада', '11:00'],
      ['Подстригване', '10:00'],
    ]);
    expect(rows[1]?.trailingFact).toMatchObject({ text: nbsp('28,00 €') });
    expect(rows[1]?.tile).toEqual({ caption: 'пн', day: 14, tone: 'past' });
    expect(drill.waiting).toBeNull();
    expect(drill.empty).toBeNull();
  });

  it('one service: its seats, titled by the service, the footer its takings', () => {
    const drill = drillOf('en', {
      drill: { analyticsFigure: AnalyticsFigure.Takings, serviceId: HAIRCUT },
    });
    expect(drill.title).toBe('Подстригване');
    expect(drill.footerValue).toBe('€28.00');
  });

  it('tips, rebooked, no-shows, late cancellations — each footer its figure', () => {
    expect(
      drillOf('bg', {
        drill: { analyticsFigure: AnalyticsFigure.Tips, serviceId: null },
      }).footerValue,
    ).toBe(nbsp('5,00 €'));
    const rebooked = drillOf('bg', {
      drill: { analyticsFigure: AnalyticsFigure.Rebooked, serviceId: null },
    });
    expect(rebooked.footerValue).toBe('1 от 2 презаписали');
    expect(
      rebooked.sections[0]?.rows.map((row) => row.trailingFact?.text),
    ).toEqual(['Без нов час', 'Презаписа']);
    expect(
      drillOf('en', {
        drill: { analyticsFigure: AnalyticsFigure.NoShows, serviceId: null },
      }).footerValue,
    ).toBe('1 entry');
    const late = drillOf('bg', {
      drill: {
        analyticsFigure: AnalyticsFigure.LateCancellations,
        serviceId: null,
      },
    });
    expect(late.footerValue).toBe('1 запис');
    expect(late.sections[0]?.rows[0]?.trailingFact?.text).toBe('Късен отказ');
  });

  it('a cached report keeps no seat rows: the page says they come with the update', () => {
    const drill = drillOf('bg', {
      report: analyticsReportFixture({ reportSeatRows: [] }),
      seatRowsHeld: false,
    });
    expect(drill.waiting).toBe(
      'Посещенията ще се покажат, щом данните се обновят.',
    );
    expect(drill.empty).toBeNull();
  });

  it('time: the days with their parts, the footer the worked time', () => {
    const drill = drillOf('bg', {
      drill: { analyticsFigure: AnalyticsFigure.Time, serviceId: null },
    });
    expect(drill.drillRows).toBe(DrillRows.Days);
    expect(drill.days.map((day) => [day.title, day.detail, day.value])).toEqual(
      [
        ['пн, 14.09', '9 ч по график · 2 ч 20 мин свободно', '4 ч 30 мин'],
        ['вт, 15.09', '9 ч по график · 3 ч 20 мин свободно', '3 ч 30 мин'],
      ],
    );
    expect(drill.footerValue).toBe('8 ч');
  });

  it('the shop: one row per barber, each opening their report; the footer the shop’s', () => {
    const drill = drillOf('bg', { report: shopReportFixture() });
    expect(drill.drillRows).toBe(DrillRows.Barbers);
    expect(drill.barbers.map((row) => [row.name, row.value])).toEqual([
      ['Иван Колев', nbsp('28,00 €')],
      ['Нико Петров', nbsp('17,50 €')],
    ]);
    expect(drill.barbers[0]?.accessibleName).toBe(
      `Виж Иван Колев, ${nbsp('28,00 €')}`,
    );
    expect(drill.footerValue).toBe(nbsp('45,50 €'));
    const time = drillOf('en', {
      report: shopReportFixture(),
      drill: { analyticsFigure: AnalyticsFigure.Time, serviceId: null },
    });
    expect(time.barbers[0]?.detail).toBe('4 h worked of 9 h');
  });

  it('is pure — the report it reads is left as it was', () => {
    const report = deepFreeze(analyticsReportFixture());
    const input = {
      words: wordsOf('bg'),
      today: localDate('2026-09-28'),
      report,
      drill: { analyticsFigure: AnalyticsFigure.Takings, serviceId: null },
      seatRowsHeld: true,
      names: NAMES,
    };
    expect(analyticsDrillVm(input)).toEqual(analyticsDrillVm(input));
  });
});

describe('analyticsVm — the month’s goal (staff-analytics-v2 CUJ 6)', () => {
  const stored = () =>
    deepFreeze(
      analyticsReportFixture({
        reportGoalLowCents: cents(180_000),
        reportGoalHighCents: cents(220_000),
        reportGoalPaceTag: GoalPaceTag.OnTrack,
        reportGoalDaysSoFar: 12,
        reportGoalDaysInMonth: 22,
      }),
    );

  it('draws the stored goal as the ring — the takings against the high end — with the range and the pace in words', () => {
    const goal = bodyOf(inputOf('bg', { report: stored() })).goal;
    expect(goal?.title).toBe('Цел за месеца');
    expect(goal?.prompt).toBeNull();
    expect(goal?.setLabel).toBe('Промени целта');
    const ring = goal?.ring;
    expect(ring?.value).toBe(4550);
    expect(ring?.min).toBe(0);
    expect(ring?.max).toBe(220_000);
    expect(ring?.figure).toBe('2%');
    expect(ring?.rangeText).toBe(`${nbsp('1800,00 €')} – ${nbsp('2200,00 €')}`);
    expect(ring?.pace).toBe('12 от 22 работни дни · на път');
    expect(ring?.paceTag).toBe(GoalPaceTag.OnTrack);
    expect(ring?.label).toBe('Цел за месеца');
    expect(ring?.accessibleName).toBe(
      `${nbsp('45,50 €')} от целта ${nbsp('1800,00 €')} – ${nbsp('2200,00 €')}`,
    );
  });

  it('words every pace, and a month without a working day yet', () => {
    const paceOf = (tag: GoalPaceTag) =>
      bodyOf(
        inputOf('bg', {
          report: deepFreeze(
            analyticsReportFixture({
              reportGoalLowCents: cents(180_000),
              reportGoalHighCents: cents(220_000),
              reportGoalPaceTag: tag,
              reportGoalDaysSoFar: tag === GoalPaceTag.None ? 0 : 3,
              reportGoalDaysInMonth: 22,
            }),
          ),
        }),
      ).goal?.ring?.pace;
    expect(paceOf(GoalPaceTag.Ahead)).toBe('3 от 22 работни дни · пред плана');
    expect(paceOf(GoalPaceTag.Behind)).toBe('3 от 22 работни дни · изоставане');
    expect(paceOf(GoalPaceTag.None)).toBe('Още няма работен ден този месец');
  });

  it('offers «Задай цел» with the prompt on this month and the next without a goal, nothing on an earlier month, nothing off MONTH', () => {
    const thisMonth = bodyOf(inputOf('bg')).goal;
    expect(thisMonth?.ring).toBeNull();
    expect(thisMonth?.setLabel).toBe('Задай цел');
    expect(thisMonth?.prompt).toBe('Задай оборот за месеца и следи темпото.');

    const next = bodyOf(
      inputOf('bg', {
        period: AnalyticsPeriod.monthOf(localDate('2026-10-05')),
      }),
    ).goal;
    expect(next?.setLabel).toBe('Задай цел');

    // The admin on a colleague's scope reads the goal and sets none; on the
    // shop, or on their own record, they set it.
    const colleague = bodyOf(
      inputOf('bg', {
        report: stored(),
        scopeBarberIds: [NIKO],
        scopeBarberId: NIKO,
        linkedBarberId: IVAN,
        scheduleBarberId: NIKO,
      }),
    ).goal;
    expect(colleague?.ring).not.toBeNull();
    expect(colleague?.setLabel).toBeNull();
    expect(
      bodyOf(
        inputOf('bg', {
          scopeBarberIds: [],
          scopeBarberId: null,
          linkedBarberId: null,
          scheduleBarberId: null,
        }),
      ).goal?.setLabel,
    ).toBe('Задай цел');
    expect(
      bodyOf(
        inputOf('bg', {
          scopeBarberIds: [IVAN],
          scopeBarberId: IVAN,
          linkedBarberId: IVAN,
        }),
      ).goal?.setLabel,
    ).toBe('Задай цел');
    expect(
      bodyOf(
        inputOf('bg', {
          scopeBarberIds: [NIKO],
          scopeBarberId: NIKO,
          linkedBarberId: IVAN,
        }),
      ).goal,
    ).toBeNull();

    const august = AnalyticsPeriod.monthOf(localDate('2026-08-05'));
    expect(bodyOf(inputOf('bg', { period: august })).goal).toBeNull();
    // An earlier month's stored goal is shown, read-only.
    const past = bodyOf(
      inputOf('bg', { period: august, report: stored() }),
    ).goal;
    expect(past?.ring).not.toBeNull();
    expect(past?.setLabel).toBeNull();

    const week = bodyOf(
      inputOf('bg', {
        period: AnalyticsPeriod.weekOf(FIXTURE_TODAY),
        report: stored(),
      }),
    ).goal;
    expect(week).toBeNull();
  });

  it('words the sheet: the store’s refusal, a failed save, and the save under way', () => {
    const sheetOf = (overrides: Partial<AnalyticsScreenInput>) =>
      bodyOf(inputOf('bg', overrides)).goal?.sheet;
    const incomplete = sheetOf({});
    expect(incomplete?.title).toBe('Цел за месеца');
    expect(incomplete?.lowLabel).toBe('Долна граница');
    expect(incomplete?.highLabel).toBe('Горна граница');
    expect(incomplete?.unit).toBe('€');
    expect(incomplete?.saveLabel).toBe('Запази');
    expect(incomplete?.refusal).toBe('Въведете двете суми');
    expect(incomplete?.saveEnabled).toBe(false);

    const invalid = sheetOf({
      goalCheck: {
        goalRefusal: AnalyticsGoalRefusal.InvalidRange,
        goalLowCents: null,
        goalHighCents: null,
      },
    });
    expect(invalid?.refusal).toBe(
      'Долната граница трябва да е до горната, и двете над нула',
    );

    const admitted = {
      goalRefusal: null,
      goalLowCents: cents(180_000),
      goalHighCents: cents(220_000),
    } as const;
    const fine = sheetOf({ goalCheck: admitted });
    expect(fine?.refusal).toBeNull();
    expect(fine?.saveEnabled).toBe(true);
    expect(fine?.saving).toBe(false);

    const failed = sheetOf({
      goalCheck: admitted,
      goalSave: AnalyticsGoalSave.Failed,
    });
    expect(failed?.refusal).toBe('Целта не се записа. Опитай пак.');
    expect(failed?.saveEnabled).toBe(true);

    const saving = sheetOf({
      goalCheck: admitted,
      goalSave: AnalyticsGoalSave.Saving,
    });
    expect(saving?.saveEnabled).toBe(false);
    expect(saving?.saving).toBe(true);
  });

  it('in English', () => {
    const goal = bodyOf(inputOf('en', { report: stored() })).goal;
    expect(goal?.title).toBe('Goal for the month');
    expect(goal?.setLabel).toBe('Change the goal');
    expect(goal?.ring?.pace).toBe('12 of 22 working days · on track');
    expect(goal?.ring?.figure).toBe('2%');
    expect(bodyOf(inputOf('en')).goal?.setLabel).toBe('Set a goal');
  });
});
