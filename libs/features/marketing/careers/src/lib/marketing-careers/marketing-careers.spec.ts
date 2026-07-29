import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import { APPOINTMENT_REPOSITORY } from '@creativo/application/booking';
import { NOTIFICATION_READER } from '@creativo/application/notifications';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  POSITION_REPOSITORY,
  Position,
  PositionRepository,
  Result,
  ok,
} from '@creativo/application/programs';
import { MarketingCareers } from './marketing-careers';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function position(
  id: string,
  overrides?: { applyUrl?: string; status?: 'open' | 'closed' },
): Position {
  return unwrap(
    Position.create({
      id,
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: [],
      status: overrides?.status ?? 'open',
      sortOrder: 0,
      ...(overrides?.applyUrl && { applyUrl: overrides.applyUrl }),
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

function repositoryStub(open: readonly Position[]): PositionRepository {
  return {
    findById: async () => ok(open[0] ?? null),
    save: async () => ok(undefined),
    observeOpen: () => of(ok(open)),
    observeAll: () => of(ok(open)),
  };
}

async function configure(
  open: readonly Position[],
): Promise<ComponentFixture<MarketingCareers>> {
  document.documentElement.setAttribute('data-theme', 'light');
  await TestBed.configureTestingModule({
    imports: [MarketingCareers],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: POSITION_REPOSITORY, useValue: repositoryStub(open) },
      {
        provide: AUTH_GATEWAY,
        useValue: { observePrincipal: () => of({ kind: 'anonymous' }) },
      },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      {
        provide: AVATAR_UPLOADER,
        useValue: { find: () => Promise.resolve(ok(null)) },
      },
      // The shared session model behind that chrome reads the profile.
      {
        provide: PROFILE_PORT,
        useValue: { getProfile: () => Promise.resolve(ok(null)) },
      },
      // …and its menu counts upcoming visits.
      {
        // The shell menu's notifications row reads the inbox.
        provide: NOTIFICATION_READER,
        useValue: {
          list: () => of(ok([])),
          markRead: async () => ok(undefined),
          markAllRead: async () => ok(undefined),
        },
      },
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: { observeUpcomingFor: () => of(ok([])) },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingCareers);
}

describe('MarketingCareers', () => {
  it('renders the real site header (solid, no hero) and footer', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-page-shell]')).not.toBeNull();
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('solid');
    expect(host.querySelector('[data-testid="site-footer"]')).not.toBeNull();
  });

  it('shows the empty state with an Instagram fallback when there are no open positions', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="careers-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="careers-list"]')).toBeNull();
  });

  it('renders one row per open position, linking to its apply URL, with a status badge', async () => {
    const fixture = await configure([
      position('pos_1', { applyUrl: 'https://example.com/apply' }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="careers-list"]');
    expect(list).not.toBeNull();
    const row = list?.querySelector('a[uilistrow]');
    expect(row?.getAttribute('href')).toBe('https://example.com/apply');
    const badge = row?.querySelector('[uibadge]');
    expect(badge?.getAttribute('data-tone')).toBe('accent');
  });

  it('badges a closed position with a neutral tone', async () => {
    const fixture = await configure([position('pos_1', { status: 'closed' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.getAttribute('data-tone')).toBe('neutral');
  });

  it('falls back to the Instagram link when a position has no applyUrl', async () => {
    const fixture = await configure([position('pos_1')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const row = host.querySelector('[data-testid="careers-list"] a[uilistrow]');
    expect(row?.getAttribute('href')).toBe(
      'https://instagram.com/creativo.barbershop',
    );
  });
});
