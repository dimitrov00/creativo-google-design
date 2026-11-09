import { Injectable, type Type, computed, signal } from '@angular/core';
import {
  type ComponentFixture,
  DeferBlockBehavior,
  TestBed,
} from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import {
  type AnalyticsCall,
  AnalyticsSpan,
  GoalPaceTag,
  Role,
  type SetAnalyticsGoalCall,
} from '@core/components';
import { PipelineError } from '@core/errors';
import type { Barber, ShopLocation } from '@core/entities';
import type { AnalyticsCallPorts } from '@core/ports';
import { AnalyticsGoalKey, Result, UserId } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  analyticsReportFixture,
  memoryAnalyticsCachePorts,
  locationsReportFixture,
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
import { IVAN, catalogueOf } from './analytics.fixtures';

/*
 * TEST SUPPORT (specs only) — the «Анализи» screens' harness: Transloco on
 * the app's real catalogue, the store's ports in memory, a scripted
 * callable that records every call and answers the fixture report (a DAY
 * cut from the fixture month; the shop's report on the shop scope when
 * asked), and the goal callable. The home and a card's screen render
 * through it alike.
 */

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg') as Translation);
  }
}

export async function settle(
  fixture: ComponentFixture<unknown>,
): Promise<void> {
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
export type RouteQuery = Partial<
  Record<'span' | 'from' | 'to' | 'barber' | 'location', string>
>;

export async function renderAnalyticsScreen<T>(
  component: Type<T>,
  options: {
    /** `:card` on a card's screen. */
    readonly card?: string;
    readonly query?: RouteQuery;
    readonly admin?: boolean;
    /** The shop's report answers the shop scope (the admin's radars). */
    readonly shop?: boolean;
    /** The callable refuses the account: no figures. */
    readonly refuse?: boolean;
    /** The shop's report compares two locations (`locationsReportFixture`). */
    readonly compareLocations?: boolean;
    /** The shop's locations in the catalogue; none by default. */
    readonly locations?: readonly ShopLocation[];
    /** The shop's barber records in the catalogue; none by default. */
    readonly barbers?: readonly Barber[];
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
      const answered =
        options.shop && call.scopeBarberIds.length !== 1
          ? shopReportFixture()
          : reportFor(call);
      const report = options.compareLocations
        ? {
            ...answered,
            reportLocations: locationsReportFixture().reportLocations,
          }
        : answered;
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
    imports: [component],
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
          barbers: signal(options.barbers ?? []),
          services: signal([]),
          barberVms: signal([]),
          locations: signal(options.locations ?? []),
          findService: () => undefined,
        },
      },
      { provide: CatalogWording, useValue: { text: () => '' } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  if (options.card !== undefined) {
    fixture.componentRef.setInput('card', options.card);
  }
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

export const byTestId = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
