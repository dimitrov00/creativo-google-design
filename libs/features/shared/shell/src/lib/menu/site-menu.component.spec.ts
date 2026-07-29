import { EnvironmentProviders, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  AVATAR_UPLOADER,
  PROFILE_PORT,
  User,
  ZonedDateTime,
} from '@creativo/application/accounts';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
} from '@creativo/application/booking';
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
import { SiteMenuComponent } from './site-menu.component';

function unwrap<T>(result: Result<T, unknown>): T {
  if (result.isFailure()) throw new Error('fixture failed');
  return result.value;
}

const ACTIVE_PRINCIPAL = unwrap(
  activePrincipal(unwrap(PrincipalId.create('user_1')), [
    roleFromPrimitive('client'),
  ]),
);

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));

function user(birthDate?: string): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Ада',
        lastName: 'Тестова',
        roles: ['client'],
        status: { kind: 'active' },
        ...(birthDate && { birthDate }),
      },
      TODAY,
    ),
  );
}

/** Local fixture — kept independent of `landing`'s shared test-i18n
 *  provider so this spec (now in `shell`) never depends back on `landing`
 *  (which itself depends on `shell` for this very component). */
const bg: Translation = {
  landing: {
    nav: { primary: 'Навигация' },
    menu: {
      bookings: 'Моите резервации',
      rewards: 'Моите награди',
      openPositions: 'Отворени позиции',
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

describe('SiteMenuComponent', () => {
  async function render(inputs: {
    open: boolean;
    isAuthed?: boolean;
    /** How many upcoming visits the bookings row should report. */
    upcoming?: number;
    displayName?: string | null;
    avatarUrl?: string | null;
    /** Omit for "no profile row yet"; pass a birth date to close that item. */
    profile?: User | null;
  }) {
    const principal: Principal = inputs.isAuthed
      ? ACTIVE_PRINCIPAL
      : ANONYMOUS_PRINCIPAL;
    await TestBed.configureTestingModule({
      imports: [SiteMenuComponent],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        {
          provide: AUTH_GATEWAY,
          useValue: {
            signOut: async () => undefined,
            // The identity portrait reads name + channel off the gateway.
            observePrincipal: () => of(principal),
            currentDisplayName: () => inputs.displayName ?? null,
            currentIdentifier: () => null,
          },
        },
        {
          provide: AVATAR_UPLOADER,
          useValue: {
            find: () =>
              Promise.resolve(
                ok(
                  inputs.avatarUrl
                    ? { url: inputs.avatarUrl, path: 'avatars/user_1' }
                    : null,
                ),
              ),
          },
        },
        {
          provide: PROFILE_PORT,
          useValue: {
            getProfile: () => Promise.resolve(ok(inputs.profile ?? null)),
          },
        },
        {
          provide: APPOINTMENT_REPOSITORY,
          useValue: {
            // The row only reads `.length`, so bare placeholders are
            // honest here — building real aggregates would test the
            // fixture, not the badge.
            observeUpcomingFor: () =>
              of(
                ok(
                  Array.from(
                    { length: inputs.upcoming ?? 0 },
                    () => ({}) as Appointment,
                  ),
                ),
              ),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SiteMenuComponent);
    fixture.componentRef.setInput('open', inputs.open);
    if (inputs.isAuthed !== undefined) {
      fixture.componentRef.setInput('isAuthed', inputs.isAuthed);
    }
    // Several passes: the avatar URL travels principal signal → observable
    // → storage-lookup promise → signal, so the portrait's <img> only
    // exists once that whole chain has settled.
    for (let pass = 0; pass < 4; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    return fixture;
  }

  it('renders the book CTA as a PROMINENT list row anchor with a LEADING calendar glyph', async () => {
    const fixture = await render({ open: true });
    const host: HTMLElement = fixture.nativeElement;

    const cta = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-book"]',
    );
    expect(cta).not.toBeNull();
    // The CTA IS a list row (owner ruling: same shape as the rows below,
    // filled with primary): ui-list-row stamps data-variant="prominent"
    // (primary fill + on-primary ink + standalone radius, list-row.css)
    // and the 52px large row box; the anchor row form is full-width
    // by contract (a.ui-list-row { inline-size: 100% }).
    expect(cta!.classList.contains('ui-list-row')).toBe(true);
    expect(cta!.getAttribute('data-variant')).toBe('prominent');
    expect(cta!.getAttribute('data-size')).toBe('large');
    // Hover/press ride the ONE shared interactive grammar, not a local one.
    expect(cta!.hasAttribute('data-interactive')).toBe(true);
    // SwiftUI Label semantics — the icon LEADS the title text, in the
    // leading slot at the same ladder step as the row glyphs below.
    const glyph = cta!.firstElementChild;
    expect(glyph?.tagName.toLowerCase()).toBe('ui-icon');
    expect(glyph?.hasAttribute('uileading')).toBe(true);
    expect(glyph?.getAttribute('data-scale')).toBe('medium');
    expect(cta!.textContent).toContain('Запази час');
    // No CTA-local styling classes — the row variant owns the look.
    expect(cta!.querySelector('.cr-menu__glyph')).toBeNull();
  });

  it('keeps every menu glyph on exactly two icon-ladder rungs: leading = medium (20px), trailing lock = small (16px) + slot ink', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    const host: HTMLElement = fixture.nativeElement;

    // The px-sized local classes are gone entirely.
    expect(host.querySelector('.cr-menu__glyph')).toBeNull();
    expect(host.querySelector('.cr-menu__trail')).toBeNull();

    // Leading glyphs (rows AND the book CTA) sit on the list-row leading
    // step of the fixed ladder: uiScale="medium" → 20px.
    const leading = host.querySelectorAll('.ui-list-row ui-icon[uileading]');
    expect(leading.length).toBeGreaterThan(0);
    for (const icon of Array.from(leading)) {
      expect(icon.getAttribute('data-scale')).toBe('medium');
    }

    // Guest trailing locks are status accessories: uiScale="small" → 16px;
    // secondary ink comes from the list-row [uiTrailing] slot contract.
    const trails = host.querySelectorAll('.ui-list-row ui-icon[uitrailing]');
    expect(trails.length).toBe(2);
    for (const icon of Array.from(trails)) {
      expect(icon.getAttribute('data-scale')).toBe('small');
    }
  });

  it('keeps list-row labels on regular foreground ink via the data-interactive anchor contract', async () => {
    const fixture = await render({ open: true });
    const host: HTMLElement = fixture.nativeElement;

    // The global bare-anchor accent rule (apps/web/src/styles.css) excludes
    // a[data-interactive] and a.ui-button — every menu anchor must fall in
    // one of those buckets so labels render at --sys-color-foreground.
    const anchors = host.querySelectorAll<HTMLAnchorElement>('.cr-menu a');
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of Array.from(anchors)) {
      const excluded =
        a.hasAttribute('data-interactive') || a.classList.contains('ui-button');
      expect(excluded).toBe(true);
    }
  });

  it('opens the signed-in menu on an identity ROW that leads to /account', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      displayName: 'Ада Тестова',
      avatarUrl: 'http://avatar/user_1.jpg',
    });
    const host: HTMLElement = fixture.nativeElement;

    const identity = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-identity"]',
    );
    expect(identity).not.toBeNull();

    // Settings.app's Apple ID grammar: a real row with a destination, not
    // a decorative header that happens to be clickable.
    expect(identity!.tagName).toBe('A');
    expect(identity!.getAttribute('href')).toBe('/account');
    expect(identity!.classList.contains('ui-list-row')).toBe(true);
    expect(identity!.getAttribute('data-interactive')).not.toBeNull();

    // Avatar rides the row's LEADING slot at a row tier, not the 112px portrait.
    const avatar = host.querySelector('[data-testid="menu-identity-avatar"]');
    expect(avatar?.getAttribute('data-control-size')).toBe('large');
    expect(avatar?.querySelector('img')?.getAttribute('src')).toBe(
      'http://avatar/user_1.jpg',
    );
    expect(
      host.querySelector('[data-testid="menu-identity-name"]')?.textContent,
    ).toContain('Ада Тестова');

    // It sits ABOVE the row run — the book CTA follows it in the document.
    const cta = host.querySelector('[data-testid="menu-book"]');
    expect(
      identity!.compareDocumentPosition(cta!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shares one segmented run with the finish-your-profile row', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      profile: user(),
    });
    const host: HTMLElement = fixture.nativeElement;
    const identity = host.querySelector('[data-testid="menu-identity"]');
    const setup = host.querySelector('[data-testid="menu-complete-profile"]');
    expect(identity).not.toBeNull();
    expect(setup).not.toBeNull();
    // Both are "your profile" — one group, not two single-row islands.
    expect(identity!.closest('ui-list-group')).toBe(
      setup!.closest('ui-list-group'),
    );
  });

  it('shows no identity row to a guest', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    expect(
      fixture.nativeElement.querySelector('[data-testid="menu-identity"]'),
    ).toBeNull();
  });

  it('shows no identity row to a guest either', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    expect(
      fixture.nativeElement.querySelector('[data-testid="menu-profile"]'),
    ).toBeNull();
  });

  it('has no profile chip at all — the identity row replaced it', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const host: HTMLElement = fixture.nativeElement;
    // An icon-only person glyph in a corner states no destination; the
    // named row below carries the job, and two paths to /account was the
    // ambiguity worth removing.
    expect(host.querySelector('[data-testid="menu-profile"]')).toBeNull();
    expect(host.querySelectorAll('a[href="/account/profile"]').length).toBe(0);
  });

  it('offers a LINEAR finish-your-profile row that resumes onboarding at the first open step', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      profile: user(),
    });
    const host: HTMLElement = fixture.nativeElement;

    const row = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-complete-profile"]',
    );
    expect(row).not.toBeNull();
    // Neither birthday nor photo is set → the birthday step comes first.
    expect(row!.getAttribute('href')).toBe(
      '/onboarding?phase=personalize&step=birthday',
    );
    expect(row!.textContent).toContain('2/4');

    // Linear, not the dashboard's ring: a determinate progress-view.
    const bar = row!.querySelector('[data-testid="menu-complete-profile-bar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-determinate')).not.toBeNull();
    expect(bar!.getAttribute('aria-valuenow')).toBe('0.5');
    expect(host.querySelector('ui-progress-ring')).toBeNull();
  });

  it('sends "continue" to the avatar step once only the photo is missing', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      profile: user('2000-05-05'),
    });

    const row = fixture.nativeElement.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-complete-profile"]',
    );
    expect(row!.getAttribute('href')).toBe(
      '/onboarding?phase=personalize&step=avatar',
    );
    expect(row!.textContent).toContain('3/4');
  });

  it('drops the nudge entirely once the profile is complete', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      profile: user('2000-05-05'),
      avatarUrl: 'http://avatar/user_1.jpg',
    });
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="menu-complete-profile"]',
      ),
    ).toBeNull();
  });

  it('shows no nudge to a guest', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="menu-complete-profile"]',
      ),
    ).toBeNull();
  });

  it('badges the bookings row with the upcoming-visit count', async () => {
    const fixture = await render({ open: true, isAuthed: true, upcoming: 2 });

    expect(
      fixture.nativeElement.querySelector('[data-testid="menu-bookings-count"]')
        ?.textContent,
    ).toContain('2');
  });

  it('shows no badge at zero — the absence already says nothing is upcoming', async () => {
    const fixture = await render({ open: true, isAuthed: true, upcoming: 0 });

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="menu-bookings-count"]',
      ),
    ).toBeNull();
  });

  it('hides the trailing locks once authed', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('ui-icon[uitrailing]').length).toBe(0);
  });
});
