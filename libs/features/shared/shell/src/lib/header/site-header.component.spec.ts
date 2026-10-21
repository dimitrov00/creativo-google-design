import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER } from '@creativo/application/accounts';
import {
  APPOINTMENT_READ_PORTS,
  INBOX_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  memoryAppointmentReadPorts,
  memoryInboxPorts,
  memoryProfilePorts,
} from '@core/testing';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  Principal,
  PrincipalId,
  Result,
  activePrincipal,
  ok,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { SiteMenuComponent } from '../menu/site-menu.component';
import { SiteHeaderComponent } from './site-header.component';

function unwrap<T>(result: Result<T, unknown>): T {
  if (result.isFailure()) throw new Error('fixture failed');
  return result.value;
}

/** An active session holding these claims. */
function active(roles: readonly string[]): Principal {
  return unwrap(
    activePrincipal(
      unwrap(PrincipalId.create('user_1')),
      roles.map((role) => roleFromPrimitive(role)),
    ),
  );
}

const bg: Translation = {
  landing: {
    nav: {
      login: 'Вход',
      menu: 'Меню',
      close: 'Затвори',
      primary: 'Навигация',
    },
    menu: {
      bookings: 'Моите резервации',
      rewards: 'Моите награди',
      staffDay: 'График',
      loyaltyAdmin: 'Лоялност',
    },
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

async function configure(
  /** Who is signed in — a guest unless said otherwise. */
  principal: Principal = ANONYMOUS_PRINCIPAL,
): Promise<ComponentFixture<SiteHeaderComponent>> {
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
        useValue: {
          observePrincipal: () => of(principal),
          // The identity portrait reads name + channel off the gateway.
          currentDisplayName: () => null,
          currentIdentifier: () => null,
          signOut: async () => undefined,
        },
      },
      // The trigger's account circle reads its photo off the shared
      // session identity (no avatar for an anonymous session).
      {
        provide: AVATAR_UPLOADER,
        useValue: { find: () => Promise.resolve(ok(null)) },
      },
      {
        provide: PROFILE_PORTS,
        useValue: memoryProfilePorts(new Map()),
      },
      // The menu's bookings row counts upcoming visits, and its
      // notifications row counts unread ones.
      {
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: memoryAppointmentReadPorts([]),
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(SiteHeaderComponent);
}

describe('SiteHeaderComponent', () => {
  it('floats transparent with the wordmark on-media by default (uiOverHero unset, no scroll)', async () => {
    const fixture = await configure();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('float');
    // The wordmark is the registry's `ui-logo` (currentColor path data);
    // its ink over the hero is the CSS's job, keyed on data-view.
    const logo = header?.querySelector('.cr-header__brand ui-logo');
    expect(logo?.querySelector('svg.ui-logo__mark path')).not.toBeNull();
    expect(header?.querySelector('.cr-header__brand img')).toBeNull();
  });

  it('is permanently solid, wordmark in the bar ink, when uiOverHero is false, even unscrolled', async () => {
    const fixture = await configure();
    fixture.componentRef.setInput('uiOverHero', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const header = host.querySelector('[data-testid="site-header"]');
    expect(header?.getAttribute('data-view')).toBe('solid');
    expect(
      header?.querySelector('.cr-header__brand ui-logo svg.ui-logo__mark'),
    ).not.toBeNull();
  });

  /**
   * The header owns the menu and hands it the session's three flags off the
   * one shared identity read model — `isAuthed`, `isStaffMember` and, since
   * client-card revision 3 (§3.17), `isAdmin`: the admin pair the menu's
   * «Лоялност» entry follows.
   */
  describe('what it hands the menu', () => {
    async function settled(fixture: ComponentFixture<SiteHeaderComponent>) {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.debugElement.query(By.directive(SiteMenuComponent))
        .componentInstance as SiteMenuComponent;
    }

    it('flags the admin pair for the menu — an admin is staff too', async () => {
      const menu = await settled(await configure(active(['admin'])));

      expect(menu.isAuthed()).toBe(true);
      expect(menu.isStaffMember()).toBe(true);
      expect(menu.isAdmin()).toBe(true);
    });

    it('keeps a barber out of the pair', async () => {
      const menu = await settled(await configure(active(['barber'])));

      expect(menu.isAuthed()).toBe(true);
      expect(menu.isStaffMember()).toBe(true);
      expect(menu.isAdmin()).toBe(false);
    });

    it('hands a guest none of the three', async () => {
      const menu = await settled(await configure());

      expect(menu.isAuthed()).toBe(false);
      expect(menu.isStaffMember()).toBe(false);
      expect(menu.isAdmin()).toBe(false);
    });

    it('opens, on the trigger, a menu holding the admin entry for an admin', async () => {
      const fixture = await configure(active(['admin']));
      await settled(fixture);
      const host: HTMLElement = fixture.nativeElement;

      host
        .querySelector<HTMLButtonElement>('[data-testid="nav-menu-trigger"]')!
        .click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="site-menu"]')).not.toBeNull();
      const row = host.querySelector<HTMLAnchorElement>(
        '[data-testid="menu-admin-loyalty"]',
      );
      expect(row).not.toBeNull();
      expect(row!.getAttribute('href')).toBe('/admin/loyalty/rhythm');
    });
  });
});
