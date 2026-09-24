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
  NOTIFICATION_READER,
  Notification,
} from '@creativo/application/notifications';
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
    /** A staff-tier session — surfaces the schedule row. */
    isStaffMember?: boolean;
    /** How many upcoming visits the bookings row should report. */
    upcoming?: number;
    /** How many UNREAD notifications the inbox should report. */
    unread?: number;
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
        {
          provide: NOTIFICATION_READER,
          useValue: {
            // The badge counts UNREAD, so the placeholders have to answer
            // `isUnread()` — that is the only thing `unreadCount` asks.
            list: () =>
              of(
                ok(
                  Array.from(
                    { length: inputs.unread ?? 0 },
                    () => ({ isUnread: () => true }) as Notification,
                  ),
                ),
              ),
            markRead: async () => ok(undefined),
            markAllRead: async () => ok(undefined),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SiteMenuComponent);
    fixture.componentRef.setInput('open', inputs.open);
    if (inputs.isAuthed !== undefined) {
      fixture.componentRef.setInput('isAuthed', inputs.isAuthed);
    }
    if (inputs.isStaffMember !== undefined) {
      fixture.componentRef.setInput('isStaffMember', inputs.isStaffMember);
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
    // Bookings, rewards, notifications — every account row is
    // guest-locked, so a signed-out menu shows three locks.
    expect(trails.length).toBe(3);
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

  it('opens the signed-in menu on a big centered identity portrait above the rows', async () => {
    const fixture = await render({
      open: true,
      isAuthed: true,
      displayName: 'Ада Тестова',
      avatarUrl: 'http://avatar/user_1.jpg',
    });
    const host: HTMLElement = fixture.nativeElement;

    const identity = host.querySelector('[data-testid="menu-identity"]');
    expect(identity).not.toBeNull();

    // The portrait tier (112px), carrying the uploaded photo.
    const avatar = host.querySelector('[data-testid="menu-identity-avatar"]');
    expect(avatar?.getAttribute('data-control-size')).toBe('extraLarge');
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

  it('makes the whole portrait a target for /account, with a real affordance', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const identity = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLAnchorElement>('[data-testid="menu-identity"]');

    // An anchor, not a div with a click handler: keyboard, focus ring and
    // middle-click come free, and the state layer is the affordance a
    // portrait otherwise lacks.
    expect(identity!.tagName).toBe('A');
    expect(identity!.getAttribute('href')).toBe('/account');
    expect(identity!.getAttribute('data-interactive')).not.toBeNull();
    // The layer fills by `border-radius: inherit`, so the block needs one.
    expect(identity!.getAttribute('data-radius')).toBe('prominent');
  });

  it('shows no identity portrait to a guest', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    expect(
      fixture.nativeElement.querySelector('[data-testid="menu-identity"]'),
    ).toBeNull();
  });

  it('shows no profile chip to a guest', async () => {
    const fixture = await render({ open: true, isAuthed: false });
    expect(
      fixture.nativeElement.querySelector('[data-testid="menu-profile"]'),
    ).toBeNull();
  });

  it('end-pins a profile chip on the trailing edge of the preferences row', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const chip = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLAnchorElement>('[data-testid="menu-profile"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('href')).toBe('/account/profile');
    // Same chip recipe as the locale/theme pair it sits opposite.
    expect(chip!.classList.contains('ui-button')).toBe(true);
    expect(chip!.getAttribute('data-icon-only')).not.toBeNull();
    // A spacer between the two ends is what pins it to the trailing edge.
    const row = chip!.closest('ui-stack');
    expect(row?.querySelector('ui-spacer')).not.toBeNull();
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

    const row = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLAnchorElement>('[data-testid="menu-complete-profile"]');
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

  it('counts unread notifications on the notifications row', async () => {
    const fixture = await render({ open: true, isAuthed: true, unread: 4 });
    const host: HTMLElement = fixture.nativeElement;

    const row = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-notifications"]',
    );
    expect(row).not.toBeNull();
    expect(row!.getAttribute('href')).toBe('/account');
    expect(
      host.querySelector('[data-testid="menu-notifications-count"]')
        ?.textContent,
    ).toContain('4');
  });

  it('shows no notifications badge at zero — same rule as the bookings count', async () => {
    const fixture = await render({ open: true, isAuthed: true, unread: 0 });
    const host: HTMLElement = fixture.nativeElement;
    expect(
      host.querySelector('[data-testid="menu-notifications"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="menu-notifications-count"]'),
    ).toBeNull();
  });

  it('guest-locks the notifications row like its siblings', async () => {
    const fixture = await render({ open: true, isAuthed: false, unread: 9 });
    const host: HTMLElement = fixture.nativeElement;
    const row = host.querySelector<HTMLAnchorElement>(
      '[data-testid="menu-notifications"]',
    );
    expect(row!.getAttribute('href')).toBe('/auth?redirect=%2Faccount');
    // A count is never leaked to a signed-out visitor.
    expect(
      host.querySelector('[data-testid="menu-notifications-count"]'),
    ).toBeNull();
  });

  it('hides the trailing locks once authed', async () => {
    const fixture = await render({ open: true, isAuthed: true });
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('ui-icon[uitrailing]').length).toBe(0);
  });

  describe('the staff schedule row', () => {
    it('is absent for a session without staff roles', async () => {
      const fixture = await render({ open: true, isAuthed: true });
      expect(
        fixture.nativeElement.querySelector('[data-testid="menu-staff-day"]'),
      ).toBeNull();
    });

    /**
     * The row's whole reason for existing: someone behind the counter opens
     * this menu to reach the day. Buried among the client rows it was the
     * app's most frequent staff destination and its least findable one.
     */
    it('leads the run, ahead of the book CTA and outside the account group', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const host: HTMLElement = fixture.nativeElement;

      const cta = host.querySelector('[data-testid="menu-book"]')!;
      const row = host.querySelector('[data-testid="menu-staff-day"]')!;
      expect(row).not.toBeNull();

      // BEFORE the CTA — the staff session's most likely action comes first.
      expect(
        row.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // …and standalone, not a member of the segmented account run.
      expect(row.closest('ui-list-group')).toBeNull();
    });

    /**
     * The filled row follows the ROLE, because the most likely action does.
     * Exactly one filled row per session either way — two would be two
     * primaries and the eye would pick neither.
     */
    it('takes the fill for staff and hands the CTA the neutral rung', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const host: HTMLElement = fixture.nativeElement;

      const row = host.querySelector('[data-testid="menu-staff-day"]')!;
      expect(row.getAttribute('data-variant')).toBe('prominent');
      expect(row.getAttribute('data-size')).toBe('large');
      expect(row.hasAttribute('data-interactive')).toBe(true);
      expect(
        host
          .querySelector('[data-testid="menu-book"]')!
          .getAttribute('data-variant'),
      ).toBe('neutral');
    });

    it('leaves the CTA prominent for everyone who is not staff', async () => {
      const fixture = await render({ open: true, isAuthed: true });
      expect(
        (fixture.nativeElement as HTMLElement)
          .querySelector('[data-testid="menu-book"]')!
          .getAttribute('data-variant'),
      ).toBe('prominent');
    });

    /**
     * An accent wash is not available as an emphasis rung: `[data-selected]`
     * paints the identical fill, so a washed row would read as permanently
     * selected. Neither row may reach for it.
     */
    it('uses no tint on either row', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const host: HTMLElement = fixture.nativeElement;
      for (const id of ['menu-staff-day', 'menu-book']) {
        const el = host.querySelector(`[data-testid="${id}"]`)!;
        expect(el.getAttribute('data-variant')).not.toBe('tinted');
        expect(el.hasAttribute('data-selected')).toBe(false);
      }
    });

    /**
     * The disclosure belongs to the phrase that names the destination
     * ("Thursday 6 August ›"), not to the row's trailing edge — the
     * reference grammar. Unscaled so it rides the footnote's own size
     * rather than snapping to the 16px accessory rung.
     */
    it('puts the disclosure chevron at the end of the subtitle line', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const row = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="menu-staff-day"]',
      )!;

      const chevron = row.querySelector('.cr-menu__staff-detail ui-icon');
      expect(chevron).not.toBeNull();
      expect(chevron!.hasAttribute('data-scale')).toBe(false);
      // …and NOT pinned to the trailing edge, where it used to sit.
      expect(
        row.querySelector('[uitrailing] ui-icon:not(.cr-menu__staff-mark)'),
      ).toBeNull();
    });

    /**
     * The title carries no `uiFont`, so it inherits the row's own
     * callout/500 and matches every neighbouring label. It shipped at
     * `headline` first and read louder than the primary CTA above it.
     */
    it('keeps the title on the same type rung as every other row label', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const title = (fixture.nativeElement as HTMLElement).querySelector(
        '.cr-menu__staff-text > span:first-child',
      )!;
      expect(title.hasAttribute('uifont')).toBe(false);
    });

    /**
     * The weekday is SHORT (owner, 2026-09-17): the longest date Bulgarian
     * can write — a Thursday in September — wrapped the subtitle to two
     * lines beside the row's mark on a 330px phone, dropping the chevron
     * under it. Pinned on exactly that date, the shop's own day.
     */
    it('subtitles itself with the day the schedule opens on — the weekday short, so the longest date stays one line', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-17T10:00:00+03:00'));
      try {
        const fixture = await render({
          open: true,
          isAuthed: true,
          isStaffMember: true,
        });
        const date = fixture.nativeElement.querySelector(
          '[data-testid="menu-staff-day-date"]',
        );
        expect(date!.textContent!.trim()).toBe('чт, 17 септември');
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Regression: the label was built from `transloco.getActiveLang()`, a
     * plain method call that captures no dependency inside a `computed` —
     * so the title beside it switched language and the date did not.
     */
    it('re-formats the date when the language changes', async () => {
      const fixture = await render({
        open: true,
        isAuthed: true,
        isStaffMember: true,
      });
      const dateOf = () =>
        (fixture.nativeElement as HTMLElement)
          .querySelector('[data-testid="menu-staff-day-date"]')!
          .textContent!.trim();

      const inBulgarian = dateOf();
      expect(/[а-я]/i.test(inBulgarian)).toBe(true);

      TestBed.inject(TranslocoService).setActiveLang('en');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const inEnglish = dateOf();
      expect(inEnglish).not.toBe(inBulgarian);
      expect(/[а-я]/i.test(inEnglish)).toBe(false);
    });
  });
});
