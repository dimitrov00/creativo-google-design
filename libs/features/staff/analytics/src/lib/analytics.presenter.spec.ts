import { describe, expect, it } from 'vitest';
import {
  AnalyticsFigure,
  AnalyticsPeriod,
  type AnalyticsReport,
} from '@core/components';
import { MinuteCount, type PriceCents, UtcEpochMs } from '@core/primitives';
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
import { AnalyticsLoad, AnalyticsTopic, DrillRows } from './analytics.vm';

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
    scopeChoices: null,
    scopeBarberId: null,
    scopeGone: false,
    scheduleBarberId: IVAN,
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
      'Седмица',
      'Месец',
    ]);
    expect(vm.period.selectedSpan).toBe('MONTH');
    expect(vm.period.label).toBe('Септември 2026\u202fг.');
    // The current month: back is offered, forward is not.
    expect(vm.period.previousEnabled).toBe(true);
    expect(vm.period.nextEnabled).toBe(false);
    // A barber has no picker.
    expect(vm.scope).toBeNull();
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
      ['Непродадено', '3 ч 20 мин'],
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

  it('words the services with their share bars, each opening its seats', () => {
    expect(body.services.rows).toEqual([
      expect.objectContaining({
        title: 'Подстригване',
        detail: '1 път · 42,00\u00a0€ на час',
        value: nbsp('28,00 €'),
        share: 2800 / 4550,
        drill: { analyticsFigure: AnalyticsFigure.Takings, serviceId: HAIRCUT },
      }),
      expect.objectContaining({ title: 'Брада', value: nbsp('17,50 €') }),
    ]);
    expect(body.services.empty).toBeNull();
  });

  it('words the clients’ figures as counts under the base of 20, with the note', () => {
    expect(body.clients.rows.map((row) => [row.label, row.value])).toEqual([
      ['Презаписали', '1 от 2'],
      ['Неявили се', '1 от 3'],
      ['Късни откази', '1'],
    ]);
    expect(body.clients.note).toBe('Процентите се показват от 20 нагоре.');
    // The shop's sections are the shop's alone.
    expect(body.fill).toBeNull();
    expect(body.origins).toBeNull();
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
      'Week',
      'Month',
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
      'Unsold',
      'Other',
    ]);
    expect(body.time.ahead).toBe(
      'Still ahead: 1 h 30 min booked · 50 min open',
    );
    expect(body.open.detail).toBe('Most on Tuesday, 09/29');
    expect(body.services.rows[0]?.detail).toBe('1 time · €42.00 an hour');
    expect(body.clients.rows.map((row) => [row.label, row.value])).toEqual([
      ['Rebooked', '1 of 2'],
      ['No-shows', '1 of 3'],
      ['Late cancellations', '1'],
    ]);
    expect(body.clients.note).toBe('Rates show from 20 up.');
  });
});

describe('analyticsVm — the admin and the shop', () => {
  const choices = StaffAnalyticsSystem.scopeChoicesOf([IVAN, NIKO], NIKO);

  it('offers the shop, «Аз», then every other barber — the chosen one ticked', () => {
    const vm = analyticsVm(
      inputOf('bg', {
        report: shopReportFixture(),
        scopeChoices: choices,
        scopeBarberId: null,
        scheduleBarberId: null,
      }),
    );
    expect(vm.scope?.tiles.map((tile) => [tile.name, tile.selected])).toEqual([
      ['Салон', true],
      ['Аз', false],
      ['Иван Колев', false],
    ]);
    expect(vm.scope?.label).toBe('Чии данни');
  });

  it('words the shop’s fill by weekday and booking origins; its services open nothing', () => {
    const body = bodyOf(
      inputOf('bg', {
        report: shopReportFixture(),
        scopeChoices: choices,
        scheduleBarberId: null,
      }),
    );
    expect(body.fill?.title).toBe('Запълване по дни');
    expect(body.fill?.rows).toEqual([
      expect.objectContaining({
        title: 'пн',
        detail: '4 ч 30 мин от 7 ч 30 мин',
        value: '60%',
        share: 0.6,
      }),
    ]);
    expect(
      body.origins?.rows.map((row) => [row.title, row.detail, row.value]),
    ).toEqual([
      ['Онлайн', '1 посещение', '50%'],
      ['От салона', '1 посещение', '50%'],
      ['Неизвестно', '0 посещения', '0%'],
    ]);
    expect(body.services.rows.every((row) => row.drill === null)).toBe(true);
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
        ['пн, 14.09', '9 ч по график · 2 ч 20 мин непродадено', '4 ч 30 мин'],
        ['вт, 15.09', '9 ч по график · 3 ч 20 мин непродадено', '3 ч 30 мин'],
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
