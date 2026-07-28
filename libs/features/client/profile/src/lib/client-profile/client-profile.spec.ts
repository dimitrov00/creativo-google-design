import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  AUTH_GATEWAY,
  PrincipalId,
  Result,
  activePrincipal,
  ok,
  fail,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { APPOINTMENT_REPOSITORY } from '@creativo/application/booking';
import { CLOCK } from '@creativo/application/shared';
import { ClientProfile } from './client-profile';

function unwrap<T>(result: Result<T, unknown>): T {
  if (result.isFailure()) throw new Error('fixture failed');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));
const PRINCIPAL = unwrap(
  activePrincipal(unwrap(PrincipalId.create('user_1')), [
    roleFromPrimitive('client'),
  ]),
);

function user(overrides?: { birthDate?: string; email?: string }): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Ада',
        lastName: 'Тестова',
        roles: ['client'],
        status: { kind: 'active' },
        ...(overrides?.birthDate && { birthDate: overrides.birthDate }),
        ...(overrides?.email && { email: overrides.email }),
      },
      TODAY,
    ),
  );
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({} as Translation);
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

interface Harness {
  fixture: ComponentFixture<ClientProfile>;
  host: HTMLElement;
  saved: User[];
  uploads: Blob[];
  removals: string[];
  settle(): Promise<void>;
}

async function render(options?: {
  profile?: User | null;
  saveResult?: () => Result<void, { code: string }>;
  uploadResult?: () => Result<{ url: string; path: string }, { code: string }>;
  photoUrl?: string | null;
  removeResult?: () => Result<void, { code: string }>;
}): Promise<Harness> {
  const saved: User[] = [];
  const uploads: Blob[] = [];
  const removals: string[] = [];
  const profile = options?.profile === undefined ? user() : options.profile;

  await TestBed.configureTestingModule({
    imports: [ClientProfile],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(PRINCIPAL),
          currentDisplayName: () => 'Ада Тестова',
          currentIdentifier: () => null,
          signOut: async () => ok(undefined),
        },
      },
      {
        provide: PROFILE_PORT,
        useValue: {
          getProfile: () => Promise.resolve(ok(profile)),
          saveProfile: (next: User) => {
            saved.push(next);
            return Promise.resolve(options?.saveResult?.() ?? ok(undefined));
          },
        },
      },
      {
        provide: AVATAR_UPLOADER,
        useValue: {
          find: () =>
            Promise.resolve(
              ok(
                options?.photoUrl
                  ? { url: options.photoUrl, path: 'avatars/user_1' }
                  : null,
              ),
            ),
          upload: (_id: unknown, data: Blob) => {
            uploads.push(data);
            return Promise.resolve(
              options?.uploadResult?.() ??
                ok({ url: 'http://avatar/user_1', path: 'avatars/user_1' }),
            );
          },
          remove: (id: { value: string }) => {
            removals.push(id.value);
            return Promise.resolve(options?.removeResult?.() ?? ok(undefined));
          },
        },
      },
      { provide: CLOCK, useValue: { now: () => ok(TODAY) } },
      // The shared header renders the menu, whose bookings row counts
      // upcoming visits.
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: { observeUpcomingFor: () => of(ok([])) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientProfile);
  // A save travels click → store → use case → getProfile → saveProfile →
  // signal, which is several promise generations; each pass flushes one.
  const settle = async () => {
    for (let pass = 0; pass < 8; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return {
    fixture,
    host: fixture.nativeElement,
    saved,
    uploads,
    removals,
    settle,
  };
}

function click(host: HTMLElement, testId: string): void {
  host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
}

function type(host: HTMLElement, testId: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(
    `[data-testid="${testId}"]`,
  );
  if (!input) throw new Error(`no input ${testId}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ClientProfile', () => {
  it('renders every value read-only, with no input chrome on the page itself', async () => {
    const { host } = await render({
      profile: user({ birthDate: '2000-05-05', email: 'ada@example.com' }),
    });

    expect(host.getAttribute('data-state')).toBe('ready');
    expect(
      host.querySelector('[data-testid="profile-row-name-value"]')?.textContent,
    ).toContain('Ада Тестова');
    expect(
      host.querySelector('[data-testid="profile-row-phone-value"]')
        ?.textContent,
    ).toContain('+359');
    expect(
      host.querySelector('[data-testid="profile-row-email-value"]')
        ?.textContent,
    ).toContain('ada@example.com');
    // The page is a list of facts until a row is tapped.
    expect(host.querySelector('main input[uiTextField]')).toBeNull();
  });

  it('marks an unset birthday and an unset email as empty, with invitation copy', async () => {
    const { host } = await render({ profile: user() });

    const birthday = host.querySelector('[data-testid="profile-row-birthday"]');
    expect(birthday?.getAttribute('data-empty')).toBe('true');
    const email = host.querySelector('[data-testid="profile-row-email"]');
    expect(email?.getAttribute('data-empty')).toBe('true');
  });

  it('keeps phone and email honestly inert — no interactive grammar, no chevron', async () => {
    const { host } = await render({
      profile: user({ email: 'ada@example.com' }),
    });

    for (const id of ['profile-row-phone', 'profile-row-email']) {
      const row = host.querySelector(`[data-testid="${id}"]`);
      // The ELEMENT row form: not a button, not an anchor.
      expect(row?.tagName.toLowerCase()).toBe('ui-list-row');
      // No `uiInteractive` → no state layer, no press, no focus ring.
      expect(row?.hasAttribute('data-interactive')).toBe(false);
      // No disclosure chevron: a row without one reads as a fact, not a door.
      expect(row?.querySelector('ui-icon')).toBeNull();
    }
    // One footnote says why, instead of a badge shouting over each value.
    expect(
      host.querySelector('[data-testid="profile-contact-locked"]'),
    ).not.toBeNull();
  });

  it('opens ONE sheet, seeded from the snapshot, when the name row is tapped', async () => {
    const { host, fixture } = await render();

    click(host, 'profile-row-name');
    fixture.detectChanges();

    expect(host.querySelectorAll('ui-modal-sheet').length).toBe(1);
    expect(
      host.querySelector('[data-testid="profile-edit-name"]'),
    ).not.toBeNull();
    expect(
      host.querySelector<HTMLInputElement>('[data-testid="profile-first-name"]')
        ?.value,
    ).toBe('Ада');
    expect(
      host.querySelector('[data-testid="profile-edit-birthday"]'),
    ).toBeNull();
  });

  it('reuses that same sheet instance for the birthday editor', async () => {
    const { host, fixture } = await render();

    click(host, 'profile-row-birthday');
    fixture.detectChanges();

    expect(host.querySelectorAll('ui-modal-sheet').length).toBe(1);
    expect(
      host.querySelector('[data-testid="profile-edit-birthday"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="profile-edit-name"]')).toBeNull();
  });

  it('keeps Save dim until the draft is both valid and changed', async () => {
    const { host, fixture } = await render();
    click(host, 'profile-row-name');
    fixture.detectChanges();

    const save = () =>
      host.querySelector<HTMLButtonElement>(
        '[data-testid="profile-sheet-save"]',
      );
    // Freshly seeded — valid, but nothing changed yet.
    expect(save()?.disabled).toBe(true);

    type(host, 'profile-first-name', 'A');
    fixture.detectChanges();
    expect(save()?.disabled).toBe(true); // changed, but too short

    type(host, 'profile-first-name', 'Ана');
    fixture.detectChanges();
    expect(save()?.disabled).toBe(false);
  });

  it('surfaces a domain validation error on blur and clears it once valid', async () => {
    const { host, fixture } = await render();
    click(host, 'profile-row-name');
    fixture.detectChanges();

    type(host, 'profile-first-name', 'A');
    host
      .querySelector('[data-testid="profile-first-name"]')
      ?.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    const error = host.querySelector(
      '[data-testid="profile-first-name-error"]',
    );
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBe('alert');
    expect(
      host
        .querySelector('[data-testid="profile-first-name"]')
        ?.getAttribute('aria-invalid'),
    ).toBe('true');

    type(host, 'profile-first-name', 'Ана');
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="profile-first-name-error"]'),
    ).toBeNull();
  });

  it('saves a new name through the profile port and closes the sheet', async () => {
    const { host, fixture, saved, settle } = await render();
    click(host, 'profile-row-name');
    fixture.detectChanges();

    type(host, 'profile-first-name', 'Ана');
    fixture.detectChanges();
    click(host, 'profile-sheet-save');
    await settle();

    expect(saved.length).toBe(1);
    expect(saved[0]?.firstName.value).toBe('Ана');
    // Untouched fields survive the rebuild.
    expect(saved[0]?.lastName.value).toBe('Тестова');
    expect(
      host.querySelector('[data-testid="profile-sheet-error"]'),
    ).toBeNull();
  });

  it('keeps the sheet open with the draft intact when the write fails', async () => {
    const { host, fixture, settle } = await render({
      saveResult: () =>
        fail({ code: 'accounts.update_profile.repository_failure' }),
    });
    click(host, 'profile-row-name');
    fixture.detectChanges();

    type(host, 'profile-first-name', 'Ана');
    fixture.detectChanges();
    click(host, 'profile-sheet-save');
    await settle();

    expect(
      host.querySelector('[data-testid="profile-sheet-error"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="profile-edit-name"]'),
    ).not.toBeNull();
    // The user's typing is never the price of a failed write.
    expect(
      host.querySelector<HTMLInputElement>('[data-testid="profile-first-name"]')
        ?.value,
    ).toBe('Ана');
  });

  it('refuses a bad photo before it reaches storage', async () => {
    const { host, fixture, uploads } = await render();
    const input = host.querySelector<HTMLInputElement>(
      '[data-testid="profile-photo-input"]',
    );
    const notAnImage = new File(['nope'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [notAnImage] });
    input?.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(uploads.length).toBe(0);
    expect(
      host.querySelector('[data-testid="profile-photo-error"]'),
    ).not.toBeNull();
  });

  it('offers NO menu when there is no photo — the lone action is the button itself', async () => {
    const { host } = await render({ photoUrl: null });

    // HIG: burying a single primary action behind a menu is the thing
    // Apple names as "not an approach we encourage".
    expect(host.querySelector('ui-menu')).toBeNull();
    const pick = host.querySelector('[data-testid="profile-photo-pick"]');
    // The span carries the button styling — `uiButton` has no
    // `label[uiButton]` selector, so a bare label renders as naked text.
    expect(pick?.classList.contains('ui-button')).toBe(true);
    expect(pick?.getAttribute('data-button-style')).toBe('plain');
    // …wrapped by the label that owns the file input.
    const label = pick?.closest('label');
    expect(label?.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('offers a menu once a photo exists, with the destructive item last', async () => {
    const { host } = await render({ photoUrl: 'http://avatar/user_1.jpg' });

    expect(host.querySelector('ui-menu')).not.toBeNull();
    const trigger = host.querySelector('[data-testid="profile-photo-pick"]');
    // A quiet plain button, not a filled capsule — it must not out-shout
    // the portrait it serves.
    expect(trigger?.getAttribute('data-button-style')).toBe('plain');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');

    const items = Array.from(host.querySelectorAll('.ui-menu__item'));
    expect(items.length).toBe(2);
    expect(items[0]?.getAttribute('data-testid')).toBe('profile-photo-replace');
    expect(items.at(-1)?.getAttribute('data-role')).toBe('destructive');
  });

  it('removes the photo and falls back to the monogram without a confirmation step', async () => {
    const { host, fixture, removals, settle } = await render({
      photoUrl: 'http://avatar/user_1.jpg',
    });

    click(host, 'profile-photo-pick');
    fixture.detectChanges();
    click(host, 'profile-photo-remove');
    await settle();

    expect(removals).toEqual(['user_1']);
    // No confirm dialog stood between the tap and the deletion.
    expect(
      host.querySelector('[data-testid="profile-photo-error"]'),
    ).toBeNull();
    // The portrait is back to the monogram, so the menu is gone with it.
    expect(host.querySelector('ui-menu')).toBeNull();
    expect(
      host.querySelector('[data-testid="profile-photo-preview"] img'),
    ).toBeNull();
  });

  it('keeps the photo and reports the failure when removal fails', async () => {
    const { host, fixture, settle } = await render({
      photoUrl: 'http://avatar/user_1.jpg',
      removeResult: () => fail({ code: 'remove_failed' }),
    });

    click(host, 'profile-photo-pick');
    fixture.detectChanges();
    click(host, 'profile-photo-remove');
    await settle();

    expect(
      host.querySelector('[data-testid="profile-photo-error"]'),
    ).not.toBeNull();
    expect(host.querySelector('ui-menu')).not.toBeNull();
  });

  it('shows a skeleton while the snapshot loads and an honest line when there is none', async () => {
    const { host } = await render({ profile: null });

    expect(host.getAttribute('data-state')).toBe('empty');
    expect(host.querySelector('[data-testid="profile-empty"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="profile-rows-personal"]'),
    ).toBeNull();
  });
});
