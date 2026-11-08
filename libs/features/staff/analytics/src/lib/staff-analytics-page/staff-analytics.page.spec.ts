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
import { afterEach, describe, expect, it } from 'vitest';
import { type AnalyticsCall, Role } from '@core/components';
import type { AnalyticsCallPorts } from '@core/ports';
import { Result, UserId } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  analyticsReportFixture,
  memoryAnalyticsCachePorts,
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

/** The route's query, as `withComponentInputBinding` sets it on the page: absent is unset. */
type RouteQuery = Partial<Record<'span' | 'from' | 'to' | 'barber', string>>;

async function render(
  options: { readonly query?: RouteQuery; readonly admin?: boolean } = {},
) {
  const principal = signal(
    options.admin
      ? principalFixture.staff(UserId.of('dev-admin'), [Role.Admin])
      : principalFixture.staff(UserId.of('dev-staff-ivan'), [Role.Barber]),
  );
  const sent: AnalyticsCall[] = [];
  const calls: AnalyticsCallPorts = {
    requestReport: async (call) => {
      sent.push(call);
      return Result.ok(analyticsReportFixture());
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
      query: { span: 'YEAR', barber: 'niko', to: '2026-09-30' },
    });
    expect(sent).toEqual([
      {
        scopeBarberId: null,
        fromLocalDate: '2026-09-01',
        analyticsSpan: 'MONTH',
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
