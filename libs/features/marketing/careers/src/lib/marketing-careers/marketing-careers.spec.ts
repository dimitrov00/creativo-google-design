import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  POSITION_READ_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { PositionStatus } from '@core/components';
import type { Position, ShopLocation } from '@core/entities';
import type { PositionReadPorts } from '@core/ports';
import { LocationId } from '@core/primitives';
import {
  locationFixture,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryPositionReadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
  positionOf,
  textFixture,
} from '@core/testing';
import { LanguageService } from '@creativo/features/shared/shell';
import { MarketingCareers } from './marketing-careers';

/** The two shops of a multi-shop tenant — «Център» (the default) and «Младост». */
const CENTER = locationFixture({ shortName: textFixture('Center', 'Център') });
const MLADOST = locationFixture({
  id: LocationId.of('loc-mladost'),
  shortName: textFixture('Mladost', 'Младост'),
  sortOrder: 1,
});

/**
 * The app's own `programs.status` words for `lang` — read, never re-typed, so
 * the badge cases pin the catalogue's words (pass E, E-17; translated by
 * OR-53). Every other key renders as itself.
 */
function programStatusWords(lang: string): Translation {
  const file = resolve(
    __dirname,
    `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly programs: { readonly status: Translation };
  };
  return { programs: { status: catalogue.programs.status } };
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(programStatusWords(lang));
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
  shops: readonly ShopLocation[] = [locationFixture()],
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
      // The catalogue's ACTIVE shops, which a scoped role names at a
      // multi-shop tenant.
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ locations: shops }),
      },
      // An anonymous visitor: the session double's default principal.
      { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
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
      // …and its schedule row names the default location's shop day.
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(
          memoryProgramsWorld({ locations: [locationFixture()] }),
        ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
      // The shell reads the injected clock (the menu's day, the footer's year).
      { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
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

  // Flip 4, F4-7: the stored status is SCREAMING (`OPEN`); the badge prints
  // the catalogue's word for it (OR-53).
  it('prints the badge text "Open" for an open role', async () => {
    const host = await render(await configure([positionOf('pos_1')]));

    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('Open');
  });

  it('prints the badge text "Closed" for a closed role', async () => {
    const host = await render(
      await configure([
        positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
      ]),
    );

    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('Closed');
  });

  it('prints the bg badge word, agreeing with «позиция» (OR-53)', async () => {
    const host = await render(await configure([positionOf('pos_1')]), 'bg');

    const badge = host.querySelector(
      '[data-testid="careers-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('Отворена');
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

  // OR-42: at a multi-shop tenant a role scoped to some shops names them
  // under its summary; a role open at every shop names none.
  it('names the shops a scoped role is open at, at a multi-shop tenant', async () => {
    const host = await render(
      await configure(
        [
          positionOf('pos_scoped', {
            locationIds: [MLADOST.id, CENTER.id],
          }),
          positionOf('pos_everywhere', { sortOrder: 1 }),
        ],
        [],
        [CENTER, MLADOST],
      ),
      'bg',
    );

    const rows = host.querySelectorAll(
      '[data-testid="careers-list"] a[uilistrow]',
    );
    expect(
      rows[0]
        ?.querySelector('[data-testid="careers-row-shops"]')
        ?.textContent?.trim(),
    ).toBe('Център · Младост');
    expect(
      rows[1]?.querySelector('[data-testid="careers-row-shops"]'),
    ).toBeNull();
  });

  it('names no shop at a one-shop tenant', async () => {
    const host = await render(
      await configure([positionOf('pos_scoped', { locationIds: [CENTER.id] })]),
    );

    expect(host.querySelector('[data-testid="careers-row-shops"]')).toBeNull();
  });
});
