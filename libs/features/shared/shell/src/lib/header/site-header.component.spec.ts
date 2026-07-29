import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import { APPOINTMENT_REPOSITORY } from '@creativo/application/booking';
import { NOTIFICATION_READER } from '@creativo/application/notifications';
import { AUTH_GATEWAY, ok } from '@creativo/application/identity';
import { SiteHeaderComponent } from './site-header.component';

const bg: Translation = {
  landing: {
    nav: {
      login: 'Вход',
      menu: 'Меню',
      close: 'Затвори',
      primary: 'Навигация',
    },
    menu: { bookings: 'Моите резервации', rewards: 'Моите награди' },
    hero: { cta: 'Запази час' },
    footer: {
      nav: {
        work: 'Нашата работа',
        team: 'Екип',
        services: 'Услуги',
        visit: 'Посети ни',
      },
    },
  },
};

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

async function configure(): Promise<ComponentFixture<SiteHeaderComponent>> {
  // `ThemeService` defaults to 'dark' whenever `<html data-theme>` isn't
  // explicitly stamped 'light' (the pre-paint boot script's job, absent in
  // this jsdom environment) — and dark mode always gets the white wordmark
  // regardless of solid/float, by the component's own documented rule.
  // Stamp 'light' so these assertions isolate the `uiOverHero` behavior
  // instead of tripping over that unrelated default.
  document.documentElement.setAttribute('data-theme', 'light');

  await TestBed.configureTestingModule({
    imports: [SiteHeaderComponent],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: AUTH_GATEWAY,
        useValue: { observePrincipal: () => of({ kind: 'anonymous' }) },
      },
      // The trigger's account circle reads its photo off the shared
      // session identity (no avatar for an anonymous session).
      {
        provide: AVATAR_UPLOADER,
        useValue: { find: () => Promise.resolve(ok(null)) },
      },
      {
        provide: PROFILE_PORT,
        useValue: { getProfile: () => Promise.resolve(ok(null)) },
      },
      // The menu's bookings row counts upcoming visits, and its
      // notifications row counts unread ones.
      {
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

  return TestBed.createComponent(SiteHeaderComponent);
}

describe('SiteHeaderComponent', () => {
  it('floats transparent with the white wordmark by default (uiOverHero unset, no scroll)', async () => {
    const fixture = await configure();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('float');
    expect(
      header?.querySelector('.cr-header__brand img')?.getAttribute('src'),
    ).toBe('/logo-white.svg');
  });

  it('is permanently solid with the dark wordmark when uiOverHero is false, even unscrolled', async () => {
    const fixture = await configure();
    fixture.componentRef.setInput('uiOverHero', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('solid');
    expect(
      header?.querySelector('.cr-header__brand img')?.getAttribute('src'),
    ).toBe('/logo-black.svg');
  });
});
