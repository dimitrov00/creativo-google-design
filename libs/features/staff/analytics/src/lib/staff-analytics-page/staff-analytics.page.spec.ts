import { Injectable, computed, signal } from '@angular/core';
import {
  type ComponentFixture,
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
} from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { Role } from '@core/components';
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

async function render() {
  const principal = signal(
    principalFixture.staff(UserId.of('dev-staff-ivan'), [Role.Barber]),
  );
  const calls: AnalyticsCallPorts = {
    requestReport: async () => Result.ok(analyticsReportFixture()),
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
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
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
      'Към 09:00',
    );
    expect(byTestId(host, 'analytics-time-bar')).not.toBeNull();
    expect(byTestId(host, 'analytics-services')).not.toBeNull();
    expect(byTestId(host, 'analytics-rebooked')?.textContent).toContain(
      '1 от 2',
    );
    // A barber has no scope picker and no shop sections.
    expect(byTestId(host, 'analytics-scopes')).toBeNull();
    expect(byTestId(host, 'analytics-fill')).toBeNull();
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
