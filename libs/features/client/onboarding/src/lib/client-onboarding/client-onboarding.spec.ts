import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  AuthDeployment,
  DEFAULT_AUTH_DEPLOYMENT,
  Identifier,
  OTP_CLIENT,
  ZonedDateTime,
  createAuthStrategy,
  examplePhoneNumber,
  ok,
  reconstituteIdentifier,
} from '@creativo/application/identity';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { CATALOG_READER } from '@creativo/application/catalog';
import { PROFILE_PORT, User } from '@creativo/application/accounts';
import { fail } from '@creativo/application/identity';
import { ClientOnboarding } from './client-onboarding';

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
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** The phone_otp flavor — the identifier channel then supplies the phone, so the about step must NOT collect one (email_otp is the workspace default). */
function phoneDeployment(): AuthDeployment {
  const strategy = createAuthStrategy({
    kind: 'phone_otp',
    required: ['phone', 'firstName', 'lastName'],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
  });
  if (strategy.isFailure()) throw new Error('fixture strategy invalid');
  return { ...DEFAULT_AUTH_DEPLOYMENT, strategy: strategy.value };
}

const EMAIL_IDENTIFIER = reconstituteIdentifier({
  kind: 'email',
  value: 'client@example.com',
});
const PHONE_IDENTIFIER = reconstituteIdentifier({
  kind: 'phone',
  value: '+359888123456',
});

/** The just-registered profile the birthday step's `UpdateProfileUseCase` loads and rebuilds. */
function seededProfile(): User {
  const todayResult = ZonedDateTime.fromISO('2026-07-25T12:00:00', 'UTC');
  if (todayResult.isFailure()) throw new Error('fixture clock invalid');
  const userResult = User.create(
    {
      id: 'uid_1',
      phone: '+359881234567',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['client'],
      status: { kind: 'active' },
    },
    todayResult.value,
  );
  if (userResult.isFailure()) throw new Error('fixture profile invalid');
  return userResult.value;
}

describe('ClientOnboarding', () => {
  const completeRegistration = vi.fn();
  const signOut = vi.fn();
  const getProfile = vi.fn();
  const saveProfile = vi.fn();
  let fixture: ComponentFixture<ClientOnboarding>;

  async function setup(
    identifier: Identifier,
    deployment?: AuthDeployment,
  ): Promise<void> {
    completeRegistration.mockReset().mockResolvedValue(ok(undefined));
    signOut.mockReset().mockResolvedValue(ok(undefined));
    getProfile.mockReset().mockResolvedValue(ok(seededProfile()));
    saveProfile.mockReset().mockResolvedValue(ok(undefined));

    await TestBed.configureTestingModule({
      imports: [ClientOnboarding],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        {
          // Frozen clock — the birthday age window must never read real time.
          provide: CLOCK,
          useValue: {
            now: (zone: string) =>
              ZonedDateTime.fromISO('2026-07-25T12:00:00', zone),
          },
        },
        ...(deployment
          ? [{ provide: AUTH_DEPLOYMENT, useValue: deployment }]
          : []),
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () =>
              of({ kind: 'onboarding', uid: { value: 'uid_1' } }),
            currentIdentifier: () => identifier,
            refreshToken: () => Promise.resolve(ok(undefined)),
            signOut,
          },
        },
        {
          provide: OTP_CLIENT,
          useValue: {
            requestChallenge: () => Promise.resolve(ok('challenge_1')),
            verifyChallenge: () =>
              Promise.resolve(ok({ kind: 'returning' as const })),
            completeRegistration,
          },
        },
        {
          provide: PROFILE_PORT,
          useValue: { getProfile, saveProfile },
        },
        {
          provide: CATALOG_READER,
          useValue: {
            listActiveServices: () => of(ok([])),
            findServiceById: () => Promise.resolve(ok(null)),
            listServiceCategories: () => of(ok([])),
            listActiveBarbers: () => of(ok([])),
            findBarberById: () => Promise.resolve(ok(null)),
            listActiveLocations: () => of(ok([])),
            findLocationById: () => Promise.resolve(ok(null)),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientOnboarding);
    fixture.detectChanges();
    // `ui-phone-field` loads the kernel phone chunk behind PendingTasks —
    // whenStable resolves once it (and the initial render) has settled.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement;
  }

  function query<T extends HTMLElement>(testId: string): T | null {
    return host().querySelector<T>(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // Store continuations (`submitAbout`, `signOutNow`) are plain floating
    // promises `whenStable` doesn't track — one macrotask turn lets the
    // immediately-resolving mocks settle through them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  function fillInput(testId: string, value: string): void {
    const input = query<HTMLInputElement>(testId);
    if (!input) throw new Error(`${testId} not rendered`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function typePhone(text: string): void {
    const input = query<HTMLInputElement>('phone-field-input');
    if (!input) throw new Error('phone input not rendered');
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  describe('email_otp deployment (the default — email identifier, phone must be collected)', () => {
    /** A real, valid national number for the deployment's default country — sourced from the kernel's own example data so validity is never a guess. */
    const exampleDigits = (
      examplePhoneNumber(DEFAULT_AUTH_DEPLOYMENT.defaultCountry) as string
    ).replace(/\D/g, '');

    beforeEach(async () => {
      await setup(EMAIL_IDENTIFIER);
    });

    it('renders the name fields AND the composite phone field from strategy.required', () => {
      expect(query('onboarding-first-name')).not.toBeNull();
      expect(query('onboarding-last-name')).not.toBeNull();
      expect(query('onboarding-phone')).not.toBeNull();
      expect(query('phone-field-input')).not.toBeNull();
    });

    it('keeps Continue disabled until the names are filled and the phone draft is valid', async () => {
      const submit = () => query<HTMLButtonElement>('onboarding-submit-about');
      expect(submit()?.disabled).toBe(true);

      fillInput('onboarding-first-name', 'Ada');
      fillInput('onboarding-last-name', 'Lovelace');
      expect(submit()?.disabled).toBe(true);

      typePhone(exampleDigits.slice(0, 3));
      expect(submit()?.disabled).toBe(true);

      typePhone(exampleDigits);
      await settle();
      expect(submit()?.disabled).toBe(false);
    });

    it('passes the collected phone through RegisterUserUseCase — the missing-field error is unreachable when filled', async () => {
      fillInput('onboarding-first-name', 'Ada');
      fillInput('onboarding-last-name', 'Lovelace');
      typePhone(exampleDigits);
      await settle();

      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();

      // The strategy's `phone` requirement was satisfied by the FORM field
      // (the email identifier can't supply it) — registration reached the
      // client and the flow advanced past about.
      expect(completeRegistration).toHaveBeenCalledTimes(1);
      const [identifier, fields] = completeRegistration.mock.calls[0];
      expect(identifier).toBe(EMAIL_IDENTIFIER);
      expect(fields.firstName).toBe('Ada');
      expect(fields.lastName).toBe('Lovelace');
      expect(fields.phone).toMatch(/^\+\d+$/);
      expect(query('onboarding-about-error')).toBeNull();
      expect(query('onboarding-reward')).not.toBeNull();
    });

    it('shows reason-mapped phone copy on blur, never per keystroke', async () => {
      typePhone(exampleDigits.slice(0, 3));
      expect(host().querySelector('.ui-phone-field__error')).toBeNull();

      query<HTMLInputElement>('phone-field-input')?.dispatchEvent(
        new Event('blur'),
      );
      await settle();

      const error = host().querySelector('.ui-phone-field__error');
      expect(error).not.toBeNull();
      // Empty test catalog → translateDomainError falls back to the raw
      // reason-mapped code — proving the reason reached the copy lookup.
      expect(error?.textContent).toContain('identity.phone.too_short');

      // Reward early: completing the number clears the error live.
      typePhone(exampleDigits);
      await settle();
      expect(host().querySelector('.ui-phone-field__error')).toBeNull();
    });
  });

  describe('optional birthday step (personalization phase, email_otp deployment)', () => {
    /** A real, valid national number so the required fields never block. */
    const exampleDigits = (
      examplePhoneNumber(DEFAULT_AUTH_DEPLOYMENT.defaultCountry) as string
    ).replace(/\D/g, '');

    beforeEach(async () => {
      await setup(EMAIL_IDENTIFIER);
    });

    function fillRequired(): void {
      fillInput('onboarding-first-name', 'Ada');
      fillInput('onboarding-last-name', 'Lovelace');
      typePhone(exampleDigits);
    }

    /** Registers, then personalizes past services onto the birthday step. */
    async function walkToBirthday(): Promise<void> {
      fillRequired();
      await settle();
      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();
      query<HTMLButtonElement>('onboarding-personalize')?.click();
      await settle();
      query<HTMLButtonElement>('onboarding-skip-services')?.click();
      await settle();
    }

    function birthSlot(segment: string): HTMLInputElement {
      const el = host().querySelector<HTMLInputElement>(
        `[data-testid="onboarding-birthday"] [data-segment="${segment}"]`,
      );
      if (!el) throw new Error(`birthday ${segment} segment not rendered`);
      return el;
    }

    function typeBirth(segment: string, text: string): void {
      const el = birthSlot(segment);
      el.value = text;
      el.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    function blurBirthGroup(): void {
      host()
        .querySelector('[data-testid="onboarding-birthday"]')
        ?.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
      fixture.detectChanges();
    }

    it('renders NO birthday group on the required about form', () => {
      expect(query('onboarding-about')).not.toBeNull();
      expect(query('onboarding-birthday')).toBeNull();
    });

    it('registers WITHOUT a birthDate — the about form submits names + phone only', async () => {
      fillRequired();
      await settle();

      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();

      expect(completeRegistration).toHaveBeenCalledTimes(1);
      const [, fields] = completeRegistration.mock.calls[0];
      expect('birthDate' in fields).toBe(false);
      expect(query('onboarding-reward')).not.toBeNull();
    });

    it('reaches the birthday step between services and avatar, clearly optional', async () => {
      await walkToBirthday();

      expect(query('onboarding-birthday-step')).not.toBeNull();
      const birthday = query('onboarding-birthday');
      expect(birthday).not.toBeNull();
      expect(birthSlot('day').getAttribute('autocomplete')).toBe('bday-day');
      expect(birthday?.querySelector('legend')).not.toBeNull();
      expect(query('onboarding-skip-birthday')).not.toBeNull();
    });

    it('keeps Save disabled until the segments form a valid date, then persists ISO via the profile port and advances to avatar', async () => {
      await walkToBirthday();
      const save = () => query<HTMLButtonElement>('onboarding-submit-birthday');
      expect(save()?.disabled).toBe(true);

      typeBirth('day', '03');
      typeBirth('month', '07');
      expect(save()?.disabled).toBe(true);
      typeBirth('year', '1990');
      await settle();
      expect(save()?.disabled).toBe(false);

      save()?.click();
      await settle();

      expect(saveProfile).toHaveBeenCalledTimes(1);
      const [savedUser] = saveProfile.mock.calls[0] as [User];
      expect(savedUser.birthDate?.toISODate()).toBe('1990-07-03');
      // Names ride along untouched from the loaded profile.
      expect(savedUser.firstName.value).toBe('Ada');
      expect(query('onboarding-avatar')).not.toBeNull();
    });

    it('skips straight to avatar without touching the profile port', async () => {
      await walkToBirthday();

      query<HTMLButtonElement>('onboarding-skip-birthday')?.click();
      await settle();

      expect(getProfile).not.toHaveBeenCalled();
      expect(saveProfile).not.toHaveBeenCalled();
      expect(query('onboarding-avatar')).not.toBeNull();
    });

    it('shows the reason-mapped quiet error on blur for an impossible date, and clears it once fixed', async () => {
      await walkToBirthday();

      typeBirth('day', '30');
      typeBirth('month', '02');
      typeBirth('year', '1990');
      expect(host().querySelector('.ui-date-field__error')).toBeNull();

      blurBirthGroup();
      await settle();
      // Empty test catalog → the raw stable code proves the reason-mapping.
      expect(
        host().querySelector('.ui-date-field__error')?.textContent,
      ).toContain('identity.birth_date.invalid');

      // Reward early: a valid date clears the error live.
      typeBirth('month', '07');
      await settle();
      expect(host().querySelector('.ui-date-field__error')).toBeNull();
    });

    it('a failed save stays on the step with quiet, code-mapped inline copy', async () => {
      saveProfile.mockResolvedValue(
        fail(new RepositoryError('firestore down')),
      );
      await walkToBirthday();

      typeBirth('day', '03');
      typeBirth('month', '07');
      typeBirth('year', '1990');
      await settle();
      query<HTMLButtonElement>('onboarding-submit-birthday')?.click();
      await settle();

      expect(query('onboarding-avatar')).toBeNull();
      expect(query('onboarding-birthday-step')).not.toBeNull();
      expect(query('onboarding-birthday-error')?.textContent).toContain(
        'accounts.update_profile.repository_failure',
      );
    });
  });

  describe('phone_otp deployment (the identifier channel supplies the phone)', () => {
    beforeEach(async () => {
      await setup(PHONE_IDENTIFIER, phoneDeployment());
    });

    it('renders NO phone input — only the name fields', () => {
      expect(query('onboarding-phone')).toBeNull();
      expect(query('phone-field-input')).toBeNull();
      expect(query('onboarding-first-name')).not.toBeNull();
      expect(query('onboarding-last-name')).not.toBeNull();
    });

    it('registers with names only — the identifier fallback satisfies the phone requirement', async () => {
      fillInput('onboarding-first-name', 'Grace');
      fillInput('onboarding-last-name', 'Hopper');
      await settle();

      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();

      expect(completeRegistration).toHaveBeenCalledTimes(1);
      const [, fields] = completeRegistration.mock.calls[0];
      // The USE CASE (not the form) fills the channel fallback.
      expect(fields.phone).toBe('+359888123456');
      expect(query('onboarding-about-error')).toBeNull();
      expect(query('onboarding-reward')).not.toBeNull();
    });

    it('signs out from the footer and lands on the home page', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi
        .spyOn(router, 'navigateByUrl')
        .mockResolvedValue(true);

      query<HTMLButtonElement>('onboarding-sign-out')?.click();
      await settle();

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/');
    });
  });
});
