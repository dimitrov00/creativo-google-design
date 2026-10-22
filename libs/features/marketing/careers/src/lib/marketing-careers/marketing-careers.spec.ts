import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER } from '@creativo/application/accounts';
import {
  APPOINTMENT_READ_PORTS,
  INBOX_PORTS,
  POSITION_READ_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { PositionStatus } from '@core/components';
import type { Position } from '@core/entities';
import type { PositionReadPorts } from '@core/ports';
import {
  memoryAppointmentReadPorts,
  memoryInboxPorts,
  memoryPositionReadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
  positionOf,
} from '@core/testing';
import { AUTH_GATEWAY, ok } from '@creativo/application/identity';
import { LanguageService } from '@creativo/features/shared/shell';
import { MarketingCareers } from './marketing-careers';

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

/**
 * The page's read, recorded: every status it asks for lands in `asked`, and
 * it answers EVERY seeded role (the memory double read unfiltered) — the
 * status filter is the adapter's query, pinned in its own spec, so a closed
 * role's badge can still be rendered here, as the legacy stub allowed.
 */
function recordedPositionReads(
  positions: readonly Position[],
  asked: (PositionStatus | null)[],
): PositionReadPorts {
  const reads = memoryPositionReadPorts(memoryProgramsWorld({ positions }));
  return {
    observePositions: (positionStatus) => {
      asked.push(positionStatus);
      return reads.observePositions(null);
    },
  };
}

async function configure(
  open: readonly Position[],
  asked: (PositionStatus | null)[] = [],
): Promise<ComponentFixture<MarketingCareers>> {
  document.documentElement.setAttribute('data-theme', 'light');
  await TestBed.configureTestingModule({
    imports: [MarketingCareers],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: POSITION_READ_PORTS,
        useValue: recordedPositionReads(open, asked),
      },
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
      { provide: PROFILE_PORTS, useValue: memoryProfilePorts(new Map()) },
      // …and its menu counts upcoming visits.
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: memoryAppointmentReadPorts([]),
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingCareers);
}

/**
 * Renders in `lang`. The shell's language service applies its own default
 * (`bg`) when the chrome first creates it — in the app, long before a row
 * arrives; here the memory read answers in the same pass — so it is booted
 * first and the visitor's language is applied after it.
 */
async function render(
  fixture: ComponentFixture<MarketingCareers>,
  lang: 'en' | 'bg' = 'en',
): Promise<HTMLElement> {
  TestBed.inject(LanguageService);
  TestBed.inject(TranslocoService).setActiveLang(lang);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement;
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
    const asked: (PositionStatus | null)[] = [];
    const fixture = await configure(
      [positionOf('pos_1', { applyUrl: 'https://example.com/apply' })],
      asked,
    );
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
    // The page asks for open roles only — once.
    expect(asked).toEqual([PositionStatus.Open]);
  });

  it('badges a closed position with a neutral tone', async () => {
    const fixture = await configure([
      positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
    ]);
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
    const fixture = await configure([positionOf('pos_1')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const row = host.querySelector('[data-testid="careers-list"] a[uilistrow]');
    expect(row?.getAttribute('href')).toBe(
      'https://instagram.com/creativo.barbershop',
    );
  });

  // Flip 4, F4-7: the stored status is SCREAMING (`OPEN`); the badge still
  // prints today's lowercase word through the page's words table.
  it('prints the badge text "open" for an open role', async () => {
    const host = await render(await configure([positionOf('pos_1')]));

    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('open');
  });

  it('prints the badge text "closed" for a closed role', async () => {
    const host = await render(
      await configure([
        positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
      ]),
    );

    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('closed');
  });

  it('prints the title and summary in the active language', async () => {
    const en = await render(await configure([positionOf('pos_1')]), 'en');
    const enRow = en.querySelector('[data-testid="careers-list"] a[uilistrow]');
    expect(enRow?.textContent).toContain('Barber');
    expect(enRow?.textContent).toContain('Full-time chair');
    TestBed.resetTestingModule();

    const bg = await render(await configure([positionOf('pos_1')]), 'bg');
    const bgRow = bg.querySelector('[data-testid="careers-list"] a[uilistrow]');
    expect(bgRow?.textContent).toContain('Бръснар');
    expect(bgRow?.textContent).toContain('Пълен работен ден');
  });
});
