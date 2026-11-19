import { EnvironmentProviders, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  AUTH_SESSION_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  LOCATION_LOAD_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts, LoadLocation } from '@core/ports';
import type { UtcEpochMs } from '@core/primitives';
import {
  barberFixture,
  locationFixture,
  memoryAuthSessionPorts,
  memoryCatalogReadPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  utcMs,
} from '@core/testing';
import { SiteFooterComponent } from './site-footer.component';

const bg: Translation = {
  landing: { prefs: { localeCode: 'БГ' }, footer: { rights: 'bg' } },
};
const en: Translation = {
  landing: { prefs: { localeCode: 'EN' }, footer: { rights: 'en' } },
};

/** Answers synchronously, as the app's loader does once a file is cached. */
@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(lang === 'en' ? en : bg);
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      reRenderOnLangChange: true,
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

describe('SiteFooterComponent', () => {
  function configure(
    now?: UtcEpochMs,
    loadLocation?: LoadLocation,
    // A fresh project's catalogue unless a test stores one.
    catalog: CatalogReadPorts = memoryCatalogReadPorts(),
  ): Promise<void> {
    return TestBed.configureTestingModule({
      imports: [SiteFooterComponent],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        // Which landing sections are drawn (`SiteSectionsService`).
        { provide: CATALOG_PORTS, useValue: catalog },
        // An anonymous visitor (the double's default session).
        { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
        // The copyright year reads the injected clock…
        { provide: CLOCK_PORTS, useValue: memoryClockPorts(now) },
        // …on the default location's calendar (Europe/Sofia).
        {
          provide: LOCATION_LOAD_PORTS,
          useValue:
            loadLocation === undefined
              ? memoryLocationLoadPorts(
                  memoryProgramsWorld({ locations: [locationFixture()] }),
                )
              : { loadLocation },
        },
        {
          provide: DEFAULT_LOCATION_PORTS,
          useValue: memoryDefaultLocationPorts(),
        },
      ],
    }).compileComponents();
  }

  function legalBar(host: HTMLElement): string | undefined {
    return host.querySelector('span[uifont="caption"]')?.textContent?.trim();
  }

  it('renders in the language chosen at bootstrap — its locale toggle, the first to inject the language service, changes nothing mid-render', async () => {
    await configure();
    // The app's bootstrap restores a returning visitor's stored choice
    // before any view renders; nothing has injected the language service.
    const transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('en');

    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const toggle = host.querySelector('[data-testid="landing-locale-toggle"]');
    expect(toggle?.textContent?.trim()).toBe('EN');
    expect(
      host.querySelectorAll('[data-testid="landing-locale-toggle"]'),
    ).toHaveLength(1);
    expect(transloco.getActiveLang()).toBe('en');
  });

  it('dates the legal bar with the year of the clock reading', async () => {
    await configure(utcMs('2027-03-01T10:00:00Z'));

    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(legalBar(fixture.nativeElement)).toBe('© 2027 Creativo · bg');
  });

  it('dates the legal bar on the SHOP’s calendar — 22:30 UTC on 31 December is already the new year in Sofia', async () => {
    await configure(utcMs('2026-12-31T22:30:00Z'));

    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    // The zone read answers on a later turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(legalBar(fixture.nativeElement)).toBe('© 2027 Creativo · bg');
  });

  it('never renders without a year while the shop’s zone is on its way — the same instant on the UTC calendar', async () => {
    await configure(
      utcMs('2026-12-31T22:30:00Z'),
      () => new Promise(() => undefined),
    );

    const fixture = TestBed.createComponent(SiteFooterComponent);
    // No `whenStable`: the zone read never answers.
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(legalBar(fixture.nativeElement)).toBe('© 2026 Creativo · bg');
  });

  /** Every sitemap row's href, in order. */
  function hrefs(host: HTMLElement): readonly (string | null)[] {
    return [...host.querySelectorAll('a.cr-footer__link')].map((link) =>
      link.getAttribute('href'),
    );
  }

  it('links no landing section a fresh project has nothing stored for — no team, no hours, no «Нашата работа», no Visit column', async () => {
    await configure();

    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(hrefs(host)).not.toContain('/#team');
    expect(hrefs(host)).not.toContain('/#visit');
    expect(hrefs(host)).not.toContain('/#work');
    // Explore and Connect stay; the Visit column has no row left.
    expect(host.querySelectorAll('.cr-footer__list')).toHaveLength(2);
    expect(hrefs(host)).toContain('/careers');
  });

  it('links the team and the hours once a public barber and a shop are stored, and the flagship’s map and number when the page names one', async () => {
    await configure(
      undefined,
      undefined,
      memoryCatalogReadPorts({
        barbers: [barberFixture()],
        locations: [locationFixture()],
      }),
    );

    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.componentRef.setInput('flagshipLocation', {
      mapUrl: 'https://maps.app.goo.gl/creativo',
      phoneE164: '+35921234567',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(hrefs(host)).toContain('/#team');
    expect(hrefs(host)).toEqual(
      expect.arrayContaining([
        'https://maps.app.goo.gl/creativo',
        'tel:+35921234567',
        '/#visit',
      ]),
    );
    // The strip waits for photos of the shop's own work.
    expect(hrefs(host)).not.toContain('/#work');
    expect(host.querySelectorAll('.cr-footer__list')).toHaveLength(3);
  });
});
