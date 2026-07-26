import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  Result,
  SHOP_EVENT_REPOSITORY,
  ShopEvent,
  ShopEventRepository,
  ok,
} from '@creativo/application/programs';
import { MarketingEvents } from './marketing-events';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function event(id: string, startDateIso: string): ShopEvent {
  return unwrap(
    ShopEvent.create({
      id,
      title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
      description: {
        en: 'Walk-in trims, no booking needed',
        bg: 'Подстригвания без резервация',
      },
      startDateIso,
      timezone: 'Europe/Sofia',
      sortOrder: 0,
    }),
  );
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

function repositoryStub(
  upcoming: readonly ShopEvent[],
  past: readonly ShopEvent[],
): ShopEventRepository {
  return {
    findById: async () => ok(upcoming[0] ?? past[0] ?? null),
    save: async () => ok(undefined),
    observeUpcoming: () => of(ok(upcoming)),
    observePast: () => of(ok(past)),
  };
}

async function configure(
  upcoming: readonly ShopEvent[],
  past: readonly ShopEvent[] = [],
): Promise<ComponentFixture<MarketingEvents>> {
  await TestBed.configureTestingModule({
    imports: [MarketingEvents],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: SHOP_EVENT_REPOSITORY,
        useValue: repositoryStub(upcoming, past),
      },
      {
        provide: AUTH_GATEWAY,
        useValue: { observePrincipal: () => of({ kind: 'anonymous' }) },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingEvents);
}

describe('MarketingEvents', () => {
  it('defaults to the Upcoming tab and shows its empty state with an Instagram fallback', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="events-empty"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="events-empty"] a[href*="instagram"]'),
    ).not.toBeNull();
  });

  it('lists upcoming events on the default tab', async () => {
    const fixture = await configure([event('event_1', '2030-06-01T10:00:00')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="events-list"]');
    expect(list?.querySelectorAll('a[uilistrow]').length).toBe(1);
  });

  it('switches to the Past tab and re-queries, with no Instagram fallback in its empty state', async () => {
    const fixture = await configure([], []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector('[data-testid="events-tab-past"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="events-empty"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="events-empty"] a[href*="instagram"]'),
    ).toBeNull();
  });
});
