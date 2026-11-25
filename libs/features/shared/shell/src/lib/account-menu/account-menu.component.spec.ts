import {
  Component,
  EnvironmentProviders,
  Injectable,
  input,
  output,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { SessionIdentityService } from '../identity/session-identity.service';
import { SiteMenuComponent } from '../menu/site-menu.component';
import { AccountMenuComponent } from './account-menu.component';

const bg: Translation = { landing: { nav: { menu: 'Меню' } } };

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg'],
      defaultLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** The site menu, inert: its own suite proves what it draws. */
@Component({ selector: 'cr-site-menu', template: '' })
class InertSiteMenu {
  readonly open = input.required<boolean>();
  readonly closeButton = input(false);
  readonly isAuthed = input(false);
  readonly isStaffMember = input(false);
  readonly worksTheBook = input(false);
  readonly managesCatalog = input(false);
  readonly isAdmin = input(false);
  readonly readsAnalytics = input(false);
  readonly opensTeam = input(false);
  readonly opensOwnProfile = input(false);
  readonly closed = output();
}

/** The owner who cuts hair: every flag the menu reads, from one identity. */
function ownerIdentity() {
  return {
    avatarUrl: signal<string | null>(null),
    displayName: signal('Иван Колев'),
    isAuthed: signal(true),
    isStaffMember: signal(true),
    worksTheBook: signal(true),
    managesCatalog: signal(true),
    isAdmin: signal(true),
    readsAnalytics: signal(true),
    opensTeam: signal(true),
    opensOwnProfile: signal(false),
  };
}

async function render(
  size?: 'regular' | 'large',
): Promise<ComponentFixture<AccountMenuComponent>> {
  TestBed.overrideComponent(AccountMenuComponent, {
    remove: { imports: [SiteMenuComponent] },
    add: { imports: [InertSiteMenu] },
  });
  await TestBed.configureTestingModule({
    imports: [AccountMenuComponent],
    providers: [
      ...provideTestI18n(),
      { provide: SessionIdentityService, useValue: ownerIdentity() },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AccountMenuComponent);
  if (size !== undefined) fixture.componentRef.setInput('size', size);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function menuOf(
  fixture: ComponentFixture<AccountMenuComponent>,
): InertSiteMenu {
  return fixture.debugElement.query(By.directive(InertSiteMenu))
    .componentInstance as InertSiteMenu;
}

function triggerOf(
  fixture: ComponentFixture<AccountMenuComponent>,
): HTMLButtonElement {
  return fixture.nativeElement.querySelector(
    '[data-testid="account-menu-trigger"]',
  );
}

describe('AccountMenuComponent', () => {
  /** The face IS the button; its name is the word, never the face (WCAG 2.5.3). */
  it('is a button named «Меню», wearing the account face hidden from a reader', async () => {
    const fixture = await render();
    const trigger = triggerOf(fixture);

    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-label')).toBeNull();
    expect(trigger.querySelector('[uivisuallyhidden]')?.textContent).toBe(
      'Меню',
    );
    const face = trigger.querySelector('ui-avatar');
    expect(face?.getAttribute('aria-hidden')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  /** The menu reads bookings, the inbox and the shops once it exists: not before anyone asks. */
  it('makes no menu until the first tap', async () => {
    const fixture = await render();
    expect(fixture.debugElement.query(By.directive(InertSiteMenu))).toBeNull();
  });

  it('opens the shared menu with its own ✕, handing it every flag the identity reads', async () => {
    const fixture = await render();

    triggerOf(fixture).click();
    fixture.detectChanges();

    const menu = menuOf(fixture);
    expect(menu.open()).toBe(true);
    expect(menu.closeButton()).toBe(true);
    expect(menu.isAuthed()).toBe(true);
    expect(menu.worksTheBook()).toBe(true);
    expect(menu.managesCatalog()).toBe(true);
    expect(menu.isAdmin()).toBe(true);
    expect(menu.opensTeam()).toBe(true);
    expect(triggerOf(fixture).getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when the menu asks', async () => {
    const fixture = await render();
    triggerOf(fixture).click();
    fixture.detectChanges();

    menuOf(fixture).closed.emit();
    fixture.detectChanges();

    // Closed, but kept: its close plays out and hands the focus back.
    expect(menuOf(fixture).open()).toBe(false);
    expect(triggerOf(fixture).getAttribute('aria-expanded')).toBe('false');
  });

  it('takes its bar’s rung on the 36/44/52 scale', async () => {
    const fixture = await render('large');
    const trigger = triggerOf(fixture);

    expect(trigger.getAttribute('data-control-size')).toBe('large');
    expect(
      trigger.querySelector('ui-avatar')?.getAttribute('data-control-size'),
    ).toBe('large');
  });
});
