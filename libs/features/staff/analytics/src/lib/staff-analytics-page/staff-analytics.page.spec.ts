import { Injectable, computed, signal } from '@angular/core';
import {
  type ComponentFixture,
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
} from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownloadFile } from '@creativo/infrastructure/web-storage';
import {
  type AnalyticsCall,
  AnalyticsSpan,
  GoalPaceTag,
  Role,
  type SetAnalyticsGoalCall,
} from '@core/components';
import { PipelineError } from '@core/errors';
import type { AnalyticsCallPorts } from '@core/ports';
import { AnalyticsGoalKey, Result, UserId } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  analyticsReportFixture,
  memoryAnalyticsCachePorts,
  shopReportFixture,
  principalFixture,
} from '@core/testing';
import {
  ANALYTICS_CACHE_PORTS,
  ANALYTICS_CALL_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import { IVAN, catalogueOf } from '../../testing/analytics.fixtures';
import { StaffAnalyticsPage } from './staff-analytics.page';

// The app's file hand-off is a browser act: the spec records what the page
// hands it instead of opening a share sheet or clicking a link.
vi.mock('@creativo/infrastructure/web-storage', async (original) => ({
  ...(await original<typeof import('@creativo/infrastructure/web-storage')>()),
  shareOrDownloadFile: vi.fn(async () => 'DOWNLOADED'),
}));

/** A blob's text — jsdom's `Blob` has no `text()`; `FileReader` it has. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg') as Translation);
  }
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

/**
 * The fixture report, answered in the call's span: a DAY is the fixture
 * month cut to the day asked for (one series point, one time point).
 */
function reportFor(call: AnalyticsCall) {
  const report = analyticsReportFixture();
  if (call.analyticsSpan !== AnalyticsSpan.Day) return report;
  const index = report.reportSeries.findIndex(
    (point) => point.localDate === call.fromLocalDate,
  );
  return analyticsReportFixture({
    reportAnalyticsSpan: AnalyticsSpan.Day,
    reportFromLocalDate: call.fromLocalDate,
    reportToLocalDate: call.fromLocalDate,
    reportSeries: report.reportSeries.slice(index, index + 1),
    reportTimeSeries: report.reportTimeSeries.slice(index, index + 1),
  });
}

/** The route's query, as `withComponentInputBinding` sets it on the page: absent is unset. */
type RouteQuery = Partial<Record<'span' | 'from' | 'to' | 'barber', string>>;

async function render(
  options: {
    readonly query?: RouteQuery;
    readonly admin?: boolean;
    /** The shop's report answers the shop scope (the admin's radars). */
    readonly shop?: boolean;
    /** The callable refuses the account: no figures. */
    readonly refuse?: boolean;
  } = {},
) {
  const principal = signal(
    options.admin
      ? principalFixture.staff(UserId.of('dev-admin'), [Role.Admin])
      : principalFixture.staff(UserId.of('dev-staff-ivan'), [Role.Barber]),
  );
  const sent: AnalyticsCall[] = [];
  const goals: SetAnalyticsGoalCall[] = [];
  const calls: AnalyticsCallPorts = {
    requestReport: async (call) => {
      sent.push(call);
      if (options.refuse) {
        return Result.err(
          PipelineError.fromWire('functions/permission-denied', {
            errorCode: 'ANALYTICS_FORBIDDEN',
          }),
        );
      }
      const report =
        options.shop && call.scopeBarberId === null
          ? shopReportFixture()
          : reportFor(call);
      // A stored goal comes back with the next report, as the callable's does.
      const goal = goals.at(-1);
      return Result.ok(
        goal === undefined
          ? report
          : {
              ...report,
              reportGoalLowCents: goal.goalLowCents,
              reportGoalHighCents: goal.goalHighCents,
              reportGoalPaceTag: GoalPaceTag.OnTrack,
              reportGoalDaysSoFar: 12,
              reportGoalDaysInMonth: 22,
            },
      );
    },
    setAnalyticsGoal: async (call) => {
      goals.push(call);
      return Result.ok({
        goalKey: AnalyticsGoalKey.of(call.scopeBarberId, call.goalMonth),
        goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
      });
    },
  };
  TestBed.configureTestingModule({
    imports: [StaffAnalyticsPage],
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      { provide: ANALYTICS_CALL_PORTS, useValue: calls },
      { provide: ANALYTICS_CACHE_PORTS, useValue: memoryAnalyticsCachePorts() },
      {
        provide: CLOCK_PORTS,
        useValue: { nowUtcMs: () => FIXTURE_NOW_UTC_MS },
      },
      {
        provide: ShopZoneService,
        useValue: { defaultZone: () => signal(FIXTURE_TIME_ZONE) },
      },
      {
        provide: SessionIdentityService,
        useValue: {
          principal,
          userId: computed(() => principal().userId),
          linkedBarberId: signal(IVAN),
        },
      },
      {
        provide: CatalogContentService,
        useValue: {
          barbers: signal([]),
          services: signal([]),
          barberVms: signal([]),
          findService: () => undefined,
        },
      },
      { provide: CatalogWording, useValue: { text: () => '' } },
    ],
  });
  const fixture = TestBed.createComponent(StaffAnalyticsPage);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    sent,
    goals,
    router: TestBed.inject(Router),
  };
}

const byTestId = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('StaffAnalyticsPage', () => {
  it('draws the barber’s month: the title, the period, the hero and every module', async () => {
    const { host } = await render();
    expect(byTestId(host, 'analytics-title')?.textContent?.trim()).toBe(
      'Анализи',
    );
    expect(byTestId(host, 'analytics-period')?.textContent).toContain(
      'Септември 2026',
    );
    expect(byTestId(host, 'analytics-takings')?.textContent).toContain('45,50');
    expect(byTestId(host, 'analytics-status')?.textContent?.trim()).toBe(
      'току-що',
    );
    expect(byTestId(host, 'analytics-time-bar')).not.toBeNull();
    expect(byTestId(host, 'analytics-services')).not.toBeNull();
    expect(byTestId(host, 'analytics-rebooked')?.textContent).toContain(
      '1 от 2',
    );
    // A barber has no scope picker and no shop sections.
    expect(byTestId(host, 'analytics-scopes')).toBeNull();
    expect(byTestId(host, 'analytics-origins')).toBeNull();
  });

  it('draws the seven questions with the chart kit: the line, the day bars and their legend, the heatmap, the seven open bars, the ranked services', async () => {
    const { host } = await render();
    expect(
      byTestId(host, 'analytics-series')?.querySelector('svg[role="img"]'),
    ).not.toBeNull();
    expect(byTestId(host, 'analytics-series-legend')?.textContent).toContain(
      'предходен период',
    );
    const dayBars = byTestId(host, 'analytics-time-bars');
    expect(dayBars?.querySelectorAll('svg .ui-bar-chart__bar').length).toBe(30);
    expect(
      dayBars?.querySelectorAll('[data-testid="analytics-time-bar"] li').length,
    ).toBe(6);
    expect(
      byTestId(host, 'analytics-bar-worked')?.querySelector(
        '.ui-chart-swatch[data-part="worked"]',
      ),
    ).not.toBeNull();
    expect(byTestId(host, 'analytics-heatmap')).not.toBeNull();
    expect(byTestId(host, 'analytics-busy-sentence')?.textContent).toContain(
      'след 7 работни дни',
    );
    expect(
      byTestId(host, 'analytics-ahead-bars')?.querySelectorAll(
        'svg .ui-bar-chart__bar',
      ).length,
    ).toBe(7);
    expect(
      byTestId(host, 'analytics-ahead-bars')?.querySelector(
        '.ui-bar-chart__bar[data-highlight]',
      ),
    ).not.toBeNull();
    expect(
      byTestId(host, 'analytics-services-bars')?.querySelectorAll(
        'svg .ui-bar-chart__bar',
      ).length,
    ).toBe(2);
  });

  it('leads the open-hours card to the emptiest day’s agenda with free time drawn', async () => {
    const { host } = await render();
    const href = byTestId(host, 'analytics-open')?.getAttribute('href') ?? '';
    expect(href).toContain('/staff/schedule?');
    expect(href).toContain('day=2026-09-29');
    expect(href).toContain('view=agenda');
    expect(href).toContain('barber=ivan');
    expect(href).toContain('free=1');
  });

  it('opens the freshness line’s ⓘ: how the figures come about', async () => {
    const { fixture, host } = await render();
    byTestId(host, 'analytics-status-info')?.click();
    await settle(fixture);
    const alert = byTestId(host, 'analytics-info');
    expect(alert?.textContent).toContain('Анализи');
    expect(alert?.textContent).toContain(
      'Цифрите се изчисляват при отваряне от записаните дни',
    );
  });

  it('opens a figure’s definition on its ⓘ', async () => {
    const { fixture, host } = await render();
    byTestId(host, 'analytics-info-TAKINGS')?.click();
    await settle(fixture);
    const alert = byTestId(host, 'analytics-info');
    expect(alert?.textContent).toContain('Оборот');
    expect(alert?.textContent).toContain('отработените услуги');
  });

  it('opens the takings’ seats on a pushed page, its footer the figure', async () => {
    const { fixture, host } = await render();
    byTestId(host, 'analytics-hero')?.click();
    await settle(fixture);
    for (const block of await fixture.getDeferBlocks()) {
      await block.render(DeferBlockState.Complete);
    }
    await settle(fixture);
    const total = byTestId(document.body, 'analytics-rows-total');
    expect(total?.textContent).toContain('Общо');
    expect(total?.textContent).toContain('45,50');
  });
});

describe('StaffAnalyticsPage — a DAY (staff-analytics-v2 PR 3)', () => {
  it('?span=DAY draws the day: three segments, the day named, the chip, one bar, no line and no heatmap', async () => {
    const { host, sent, router } = await render({
      query: { span: 'DAY', from: '2026-09-15' },
    });
    expect(sent.at(-1)).toMatchObject({
      analyticsSpan: 'DAY',
      toLocalDate: null,
      fromLocalDate: '2026-09-15',
      analyticsComparison: 'PREVIOUS',
    });
    expect(byTestId(host, 'analytics-span')?.textContent).toContain('Ден');
    expect(byTestId(host, 'analytics-period')?.textContent).toContain(
      'вторник, 15.09',
    );
    expect(
      byTestId(host, 'analytics-comparison-chip')?.textContent?.trim(),
    ).toBe('спрямо предходния период');
    expect(byTestId(host, 'analytics-series')).toBeNull();
    expect(byTestId(host, 'analytics-busy')).toBeNull();
    expect(
      byTestId(host, 'analytics-time-bars')?.querySelectorAll(
        'svg .ui-bar-chart__bar',
      ).length,
    ).toBe(1);
    expect(router.url).toContain('span=DAY');
    expect(router.url).toContain('from=2026-09-15');
  });
});

describe('StaffAnalyticsPage — the admin’s radars (staff-analytics-v2 PR 5)', () => {
  it('draws one radar per barber on the shop’s report, and a tap opens that barber’s scope', async () => {
    const { host, sent, fixture } = await render({ admin: true, shop: true });
    const radars = byTestId(host, 'analytics-radars');
    expect(radars).not.toBeNull();
    expect(byTestId(host, 'analytics-radars-base')?.textContent?.trim()).toBe(
      'спрямо най-добрия в салона',
    );
    expect(radars?.querySelectorAll('ui-radar').length).toBe(2);
    expect(radars?.querySelector('ui-radar')?.getAttribute('data-tone')).toBe(
      '0',
    );
    byTestId(host, 'analytics-radar-niko')?.click();
    await settle(fixture);
    expect(sent.at(-1)?.scopeBarberId).toBe('niko');
    // A barber's report carries no radars.
    expect(byTestId(host, 'analytics-radars')).toBeNull();
  });
});

describe('StaffAnalyticsPage — the dock’s «Експорт» (staff-analytics-v2 CUJ 7)', () => {
  afterEach(() => vi.mocked(shareOrDownloadFile).mockClear());

  it('hands the figures on screen to the file hand-off as the CSV, from the tap', async () => {
    const { host, fixture } = await render();
    const button = byTestId(host, 'analytics-export') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Експорт');
    expect(button.closest('ui-page-action-bar')).not.toBeNull();
    button.click();
    await settle(fixture);
    const handed = vi.mocked(shareOrDownloadFile).mock.calls;
    expect(handed).toHaveLength(1);
    const [name, blob] = handed[0] as [string, Blob];
    expect(name).toBe('creativo-analytics-2026-09-01-2026-09-30.csv');
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const text = await blobText(blob);
    // FileReader decodes the byte-order mark away; the presenter's spec pins it.
    expect(text.split('\r\n')[0]).toBe(
      'вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш',
    );
  });

  it('offers nothing to export while there are no figures', async () => {
    const { host } = await render({ refuse: true });
    expect(byTestId(host, 'analytics-export')).toBeNull();
  });
});

describe('StaffAnalyticsPage — the month’s goal (staff-analytics-v2 CUJ 6)', () => {
  it('offers «Задай цел» on this month, saves the sheet’s range and draws the ring from the next report', async () => {
    const { host, fixture, goals, sent } = await render();
    const section = byTestId(host, 'analytics-goal');
    expect(section).not.toBeNull();
    expect(byTestId(host, 'analytics-goal-ring')).toBeNull();
    expect(byTestId(host, 'analytics-goal-prompt')?.textContent?.trim()).toBe(
      'Задай оборот за месеца и следи темпото.',
    );
    const set = byTestId(host, 'analytics-goal-set') as HTMLButtonElement;
    expect(set.textContent?.trim()).toBe('Задай цел');
    set.click();
    await settle(fixture);
    const sheet = byTestId(host, 'analytics-goal-sheet');
    expect(sheet?.getAttribute('data-state')).toBe('open');
    const save = byTestId(host, 'analytics-goal-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const type = (id: string, raw: string) => {
      const input = byTestId(host, id) as HTMLInputElement;
      input.value = raw;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
    };
    type('analytics-goal-low', '1800');
    type('analytics-goal-high', '2200');
    await settle(fixture);
    expect(save.disabled).toBe(false);
    const requests = sent.length;
    save.click();
    await settle(fixture);
    await settle(fixture);
    // The range went to the callable for the barber's own scope and month,
    // the report was asked for again, and the ring shows the goal.
    expect(goals).toEqual([
      {
        scopeBarberId: null,
        goalMonth: '2026-09',
        goalLowCents: 180_000,
        goalHighCents: 220_000,
      },
    ]);
    expect(sent.length).toBe(requests + 1);
    expect(sheet?.getAttribute('data-state')).not.toBe('open');
    expect(byTestId(host, 'analytics-goal-ring')).not.toBeNull();
    expect(byTestId(host, 'analytics-goal-pace')?.textContent?.trim()).toBe(
      '12 от 22 работни дни · на път',
    );
    expect(
      (
        byTestId(host, 'analytics-goal-set') as HTMLButtonElement
      ).textContent?.trim(),
    ).toBe('Промени целта');
  });

  it('has no goal section on a week', async () => {
    const { host } = await render({
      query: { span: 'WEEK', from: '2026-09-28' },
    });
    expect(byTestId(host, 'analytics-goal')).toBeNull();
  });
});

describe('StaffAnalyticsPage — the URL as inputs (route-inputs.ts)', () => {
  it('?span=WEEK&from=<day> binds: the week that holds the day, asked for once, written back as its first day', async () => {
    const { host, sent, router } = await render({
      query: { span: 'WEEK', from: '2026-09-30' },
    });
    expect(byTestId(host, 'analytics-period')?.textContent).toContain('28.09');
    expect(sent).toEqual([
      {
        scopeBarberId: null,
        fromLocalDate: '2026-09-28',
        analyticsSpan: 'WEEK',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    // The first write-back: the period's first day, the span, no barber for a barber.
    expect(router.url).toBe('/?span=WEEK&from=2026-09-28');
  });

  it('a silent URL is this month, written back once the request stands', async () => {
    const { host, sent, router } = await render();
    expect(byTestId(host, 'analytics-period')?.textContent).toContain(
      'Септември 2026',
    );
    expect(sent).toHaveLength(1);
    expect(router.url).toBe('/?span=MONTH&from=2026-09-01');
  });

  it('a barber’s ?barber= is ignored; an unknown span is a month', async () => {
    const { sent, router } = await render({
      query: { span: 'QUARTER', barber: 'niko', to: '2026-09-30' },
    });
    expect(sent).toEqual([
      {
        scopeBarberId: null,
        fromLocalDate: '2026-09-01',
        analyticsSpan: 'MONTH',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    // `to` is kept by the merge and ignored; the ignored barber is dropped.
    expect(router.url).toBe('/?span=MONTH&from=2026-09-01');
  });

  it('an admin’s ?barber= is the scope, and a pick replaces the URL without a second request for the echo', async () => {
    const { fixture, host, sent, router } = await render({
      query: { span: 'WEEK', from: '2026-09-30', barber: 'ivan' },
      admin: true,
    });
    expect(sent).toEqual([
      {
        scopeBarberId: 'ivan',
        fromLocalDate: '2026-09-28',
        analyticsSpan: 'WEEK',
        toLocalDate: null,
        analyticsComparison: 'PREVIOUS',
      },
    ]);
    expect(router.url).toBe('/?span=WEEK&from=2026-09-28&barber=ivan');

    byTestId(host, 'analytics-previous')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(router.url).toBe('/?span=WEEK&from=2026-09-21&barber=ivan');
    // The pick's request, and nothing for the URL's echo.
    expect(sent).toHaveLength(2);
    expect(sent[1]?.fromLocalDate).toBe('2026-09-21');
  });
});
