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
  CLOCK_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { UtcEpochMs } from '@core/primitives';
import { memoryAuthSessionPorts, memoryClockPorts, utcMs } from '@core/testing';
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
  function configure(now?: UtcEpochMs): Promise<void> {
    return TestBed.configureTestingModule({
      imports: [SiteFooterComponent],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        // An anonymous visitor (the double's default session).
        { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
        // The copyright year reads the injected clock.
        { provide: CLOCK_PORTS, useValue: memoryClockPorts(now) },
      ],
    }).compileComponents();
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

    const legal = (fixture.nativeElement as HTMLElement).querySelector(
      'span[uifont="caption"]',
    );
    expect(legal?.textContent?.trim()).toBe('© 2027 Creativo · bg');
  });
});
