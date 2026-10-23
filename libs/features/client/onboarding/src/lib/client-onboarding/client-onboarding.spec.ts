import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthDeployment,
  AuthStrategy,
  AuthStrategyKind,
  type CountryIso2,
  Email,
  E164,
  type MediaRef,
  ParsedIdentifier,
  type Principal,
  RegistrationField,
} from '@core/components';
import type { Service, User } from '@core/entities';
import {
  Callables,
  type LoadProfile,
  type MediaResolvePorts,
  type MediaVariant,
} from '@core/ports';
import {
  AccountsErrorCode,
  IdentityErrorCode,
  MediaError,
  MediaRefId,
  PipelineError,
  Result,
  ServiceId,
  type UserId,
} from '@core/primitives';
import { PhoneSystem } from '@core/systems';
import {
  type GatewayCall,
  type OtpChallengeCall,
  immediateTimerPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryCatalogReadPorts,
  memoryClockPorts,
  memoryOtpChallengePorts,
  memoryProfilePorts,
  principalFixture,
  registeredUserFixture,
  scriptedGatewayPorts,
  serviceFixture,
  termsFixture,
  utcMs,
} from '@core/testing';
import {
  AUTH_DEPLOYMENT_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  GATEWAY_PORTS,
  MEDIA_RESOLVE_PORTS,
  OTP_CHALLENGE_PORTS,
  PROFILE_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { CatalogContentService } from '@creativo/features/shared/catalog';
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
  const strategy = AuthStrategy.parse({
    authStrategyKind: AuthStrategyKind.PhoneOtp,
    required: [
      RegistrationField.Phone,
      RegistrationField.FirstName,
      RegistrationField.LastName,
    ],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
  });
  if (!strategy.ok) throw new Error('fixture strategy invalid');
  return { ...AuthDeployment.DEFAULT, strategy: strategy.value };
}

const EMAIL_IDENTIFIER: ParsedIdentifier = ((): ParsedIdentifier => {
  const email = Email.parse('client@example.com');
  if (email === null) throw new Error('fixture email invalid');
  return ParsedIdentifier.email(email);
})();
const PHONE_IDENTIFIER: ParsedIdentifier = ParsedIdentifier.phone(
  E164.of('+359888123456'),
);

const UID = principalFixture.onboarding().userId;

/** The just-registered profile the birthday step's owner write reads and edits. */
function seededProfile(): User {
  return registeredUserFixture({
    id: UID,
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
}

type MediaAnswer = Result<readonly MediaVariant[], MediaError>;

/** Answers every resolve with nothing — the default: no covers, no requests of interest. */
const NO_MEDIA: MediaResolvePorts = {
  resolveMedia: () => Promise.resolve(Result.ok([])),
};

/**
 * Holds every resolve until the test answers it, so a failure can land
 * AFTER the test takes over the clock (the walk to the services grid runs
 * on real timers; the retry backoff is only steppable on fake ones).
 */
type HeldMedia = MediaResolvePorts & {
  readonly calls: readonly string[];
  /** Answers the oldest resolve still waiting. */
  answer(answer: MediaAnswer): void;
};

function heldMedia(): HeldMedia {
  const calls: string[] = [];
  const held: ((answer: MediaAnswer) => void)[] = [];
  return {
    calls,
    resolveMedia: (ref: MediaRef) => {
      calls.push(ref.mediaPath);
      return new Promise<MediaAnswer>((resolve) => held.push(resolve));
    },
    answer: (answer) => {
      const next = held.shift();
      if (!next) throw new Error('no resolve is waiting for an answer');
      next(answer);
    },
  };
}

/** The Storage object the fixture service's cover points at. */
const COVER = { path: 'services/fade.jpg', width: 1200 } as const;
const COVER_URL = `https://cdn.test/${COVER.path}`;

const FADE: Service = serviceFixture({
  id: ServiceId.of('svc-fade'),
  name: { en: 'Skin fade', bg: 'Фейд' },
  description: { en: 'x', bg: 'x' },
  ...termsFixture(1750, 50),
  offerings: [],
  locationIds: [],
  popular: true,
  sortOrder: 1,
  coverMediaId: MediaRefId.of('media-fade'),
  coverMediaPath: COVER.path,
  coverMediaWidth: COVER.width,
  coverMediaHeight: 1500,
});

/** A real, valid national number for `country` — the phone metadata's own example, so validity is never a guess. */
function exampleDigitsOf(country: CountryIso2): string {
  return (PhoneSystem.example(country) ?? '').replace(/\D/g, '');
}

/** The longest wait the default retry policy can pick after the first failure. */
const FIRST_BACKOFF_CEILING_MS = 2_000;

describe('ClientOnboarding', () => {
  /** Every OTP callable the store dialled, in order. */
  let otpCalls: OtpChallengeCall[];
  /** Every gateway callable the store dialled (the profile save), in order. */
  let gatewayCalls: GatewayCall[];
  const signOut = vi.fn();
  /** `users/{uid}` as the memory port holds it — what the session model reads. */
  let users: Map<UserId, User>;
  /** One-shot profile reads; the session model listens instead. */
  const loadProfile = vi.fn<LoadProfile>();
  /** A spec sets it to make the `updateProfile` call fail as a store failure. */
  let writeFails: boolean;
  const uploadAvatarFile = vi.fn();
  let fixture: ComponentFixture<ClientOnboarding>;

  async function setup(
    identifier: ParsedIdentifier,
    deployment?: AuthDeployment,
    catalog: {
      readonly services: readonly Service[];
      readonly media: MediaResolvePorts;
    } = { services: [], media: NO_MEDIA },
  ): Promise<void> {
    otpCalls = [];
    gatewayCalls = [];
    signOut.mockReset().mockReturnValue(Result.ok(undefined));
    users = new Map([[UID, seededProfile()]]);
    const memory = memoryProfilePorts(users);
    loadProfile.mockReset().mockImplementation(memory.loadProfile);
    writeFails = false;
    const avatars = memoryAvatarPorts();
    uploadAvatarFile.mockReset().mockImplementation(avatars.uploadAvatar);

    await TestBed.configureTestingModule({
      imports: [ClientOnboarding],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        // Frozen clock — the birthday age window must never read real time.
        {
          provide: CLOCK_PORTS,
          useValue: memoryClockPorts(utcMs('2026-07-25T12:00:00.000Z')),
        },
        ...(deployment
          ? [
              {
                provide: AUTH_DEPLOYMENT_PORTS,
                useValue: { authDeployment: deployment },
              },
            ]
          : []),
        {
          provide: AUTH_SESSION_PORTS,
          useValue: memoryAuthSessionPorts({
            principals$: new BehaviorSubject<Principal>(
              principalFixture.onboarding(UID),
            ),
            identifier,
            signOut,
          }),
        },
        { provide: TIMER_PORTS, useValue: immediateTimerPorts() },
        {
          provide: OTP_CHALLENGE_PORTS,
          useValue: memoryOtpChallengePorts({ calls: otpCalls }),
        },
        {
          provide: GATEWAY_PORTS,
          useValue: scriptedGatewayPorts(
            {
              [Callables.UpdateProfile]: () =>
                writeFails
                  ? Result.err(PipelineError.fromWire('internal', null))
                  : Result.ok({ changed: true }),
            },
            gatewayCalls,
          ),
        },
        { provide: PROFILE_PORTS, useValue: { ...memory, loadProfile } },
        {
          provide: AVATAR_PORTS,
          useValue: {
            ...avatars,
            uploadAvatar: (...args: Parameters<typeof avatars.uploadAvatar>) =>
              uploadAvatarFile(...args),
          },
        },
        {
          provide: CATALOG_PORTS,
          useValue: memoryCatalogReadPorts({ services: catalog.services }),
        },
        { provide: MEDIA_RESOLVE_PORTS, useValue: catalog.media },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientOnboarding);
    fixture.detectChanges();
    // `ui-phone-field` loads the phone chunk behind PendingTasks —
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
    /** A real, valid national number for the deployment's default country — sourced from the phone metadata's own example data so validity is never a guess. */
    const exampleDigits = exampleDigitsOf(
      AuthDeployment.DEFAULT.defaultCountry,
    );

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

    it('passes the collected phone through registerUser — the missing-field error is unreachable when filled', async () => {
      fillInput('onboarding-first-name', 'Ada');
      fillInput('onboarding-last-name', 'Lovelace');
      typePhone(exampleDigits);
      await settle();

      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();

      // The strategy's `phone` requirement was satisfied by the FORM field
      // (the email identifier can't supply it) — registration reached the
      // client and the flow advanced past about.
      expect(otpCalls).toHaveLength(1);
      const call = otpCalls[0];
      if (call?.otpCall !== 'COMPLETE') throw new Error('no registration');
      expect(call.identifier).toEqual(EMAIL_IDENTIFIER);
      expect(call.fields.firstName).toBe('Ada');
      expect(call.fields.lastName).toBe('Lovelace');
      expect(call.fields.phone).toMatch(/^\+\d+$/);
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
      // `<errorCode>.<reason>` key — proving the reason reached the copy
      // lookup, unmapped.
      expect(error?.textContent).toContain('PHONE_INVALID.too-short');

      // Reward early: completing the number clears the error live.
      typePhone(exampleDigits);
      await settle();
      expect(host().querySelector('.ui-phone-field__error')).toBeNull();
    });
  });

  describe('optional birthday step (personalization phase, email_otp deployment)', () => {
    /** A real, valid national number so the required fields never block. */
    const exampleDigits = exampleDigitsOf(
      AuthDeployment.DEFAULT.defaultCountry,
    );

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

      expect(otpCalls).toHaveLength(1);
      const call = otpCalls[0];
      if (call?.otpCall !== 'COMPLETE') throw new Error('no registration');
      expect(call.fields.birthDate).toBeNull();
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

    it('keeps Save disabled until the segments form a valid date, then sends ISO through updateProfile and advances to avatar', async () => {
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

      // Names ride along untouched: `null` keeps the stored ones.
      expect(gatewayCalls).toEqual([
        {
          callable: Callables.UpdateProfile,
          input: { firstName: null, lastName: null, birthDate: '1990-07-03' },
        },
      ]);
      expect(query('onboarding-avatar')).not.toBeNull();
    });

    it('offers Save (gated on a staged photo) and an always-live Skip on the avatar step', async () => {
      await walkToBirthday();
      query<HTMLButtonElement>('onboarding-skip-birthday')?.click();
      await settle();

      // Nothing picked yet — "save this photo" would be a lie, so the
      // primary is dim and Skip is the honest way out.
      expect(
        query<HTMLButtonElement>('onboarding-avatar-enter-app')?.disabled,
      ).toBe(true);
      expect(query('onboarding-skip-avatar')).not.toBeNull();
    });

    it('tells the shared avatar lookup about a photo that landed, and never about one that failed', async () => {
      const refresh = vi.spyOn(
        TestBed.inject(SessionIdentityService),
        'refreshAvatar',
      );
      const createObjectURL = URL.createObjectURL;
      const revokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = () => 'blob:preview';
      URL.revokeObjectURL = () => undefined;
      try {
        await walkToBirthday();
        query<HTMLButtonElement>('onboarding-skip-birthday')?.click();
        await settle();
        const pick = async (): Promise<void> => {
          const input = query<HTMLInputElement>('onboarding-avatar-input');
          if (!input) throw new Error('avatar input not rendered');
          Object.defineProperty(input, 'files', {
            value: [new File(['x'], 'me.png', { type: 'image/png' })],
            configurable: true,
          });
          input.dispatchEvent(new Event('change'));
          await settle();
        };

        uploadAvatarFile.mockResolvedValueOnce(
          Result.err(MediaError.transient('avatars/uid_1/original')),
        );
        await pick();
        query<HTMLButtonElement>('onboarding-avatar-enter-app')?.click();
        await settle();
        expect(uploadAvatarFile).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();

        await pick();
        query<HTMLButtonElement>('onboarding-avatar-enter-app')?.click();
        await settle();
        expect(uploadAvatarFile).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledTimes(1);
      } finally {
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
      }
    });

    it('skips straight to avatar without reading or writing the profile', async () => {
      await walkToBirthday();
      // The shared session model reads the profile on its own (it backs
      // the app-wide chrome), so the invariant is that SKIPPING adds no
      // reads and no writes of its own — not that nothing ever read.
      const readsBefore = loadProfile.mock.calls.length;

      query<HTMLButtonElement>('onboarding-skip-birthday')?.click();
      await settle();

      expect(loadProfile.mock.calls.length).toBe(readsBefore);
      expect(gatewayCalls).toEqual([]);
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
      ).toContain(IdentityErrorCode.BirthDateInvalid);

      // Reward early: a valid date clears the error live.
      typeBirth('month', '07');
      await settle();
      expect(host().querySelector('.ui-date-field__error')).toBeNull();
    });

    it('a failed save stays on the step with quiet, code-mapped inline copy', async () => {
      writeFails = true;
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
        AccountsErrorCode.UpdateProfileRepositoryFailure,
      );
    });
  });

  describe('service covers (the shared catalogue media cache)', () => {
    const exampleDigits = exampleDigitsOf(
      AuthDeployment.DEFAULT.defaultCountry,
    );

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Registers, then personalizes onto the services grid. */
    async function walkToServices(): Promise<void> {
      fillInput('onboarding-first-name', 'Ada');
      fillInput('onboarding-last-name', 'Lovelace');
      typePhone(exampleDigits);
      await settle();
      query<HTMLButtonElement>('onboarding-submit-about')?.click();
      await settle();
      query<HTMLButtonElement>('onboarding-personalize')?.click();
      await settle();
      expect(query('onboarding-services-list')).not.toBeNull();
    }

    function coverSrc(): string | null {
      fixture.detectChanges();
      const card = query(`service-card-${FADE.id}`);
      if (!card) throw new Error('service card not rendered');
      return (
        card.querySelector('img.ui-async-image__image')?.getAttribute('src') ??
        null
      );
    }

    /** Steps the fake clock, then hands it back so the fixture can settle. */
    async function elapseThenRealTime(ms: number): Promise<void> {
      await vi.advanceTimersByTimeAsync(ms);
      vi.useRealTimers();
      await settle();
    }

    it('shows the resolved cover on the card', async () => {
      const media = heldMedia();
      await setup(EMAIL_IDENTIFIER, undefined, { services: [FADE], media });
      await walkToServices();
      expect(coverSrc()).toBeNull();

      media.answer(Result.ok([{ width: COVER.width, url: COVER_URL }]));
      await settle();

      expect(coverSrc()).toBe(COVER_URL);
      expect(media.calls).toEqual([COVER.path]);
    });

    it('reads each card’s cover off its own service, never by searching the catalogue', async () => {
      const media = heldMedia();
      await setup(EMAIL_IDENTIFIER, undefined, { services: [FADE], media });
      await walkToServices();
      // Every card asks on every pass: a search per card was O(n²). The
      // spy is in place before the cover lands, so the pass that paints it
      // is one that asked.
      const search = vi.spyOn(
        TestBed.inject(CatalogContentService),
        'findService',
      );
      media.answer(Result.ok([{ width: COVER.width, url: COVER_URL }]));
      await settle();

      expect(coverSrc()).toBe(COVER_URL);
      expect(search).not.toHaveBeenCalled();
    });

    it('retries a cover whose first resolve failed transiently, then shows it', async () => {
      const media = heldMedia();
      await setup(EMAIL_IDENTIFIER, undefined, { services: [FADE], media });
      await walkToServices();

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      media.answer(Result.err(MediaError.transient(COVER.path)));
      await vi.advanceTimersByTimeAsync(0);
      expect(coverSrc()).toBeNull();

      await vi.advanceTimersByTimeAsync(FIRST_BACKOFF_CEILING_MS);
      expect(media.calls).toEqual([COVER.path, COVER.path]);

      media.answer(Result.ok([{ width: COVER.width, url: COVER_URL }]));
      await elapseThenRealTime(100);
      expect(coverSrc()).toBe(COVER_URL);
    });

    it.each([
      ['not_found', MediaError.notFound(COVER.path)],
      ['forbidden', MediaError.forbidden(COVER.path)],
    ] as const)(
      'asks once about a permanently unavailable cover (%s) and keeps the card on its fallback',
      async (_reason, refusal) => {
        const media = heldMedia();
        await setup(EMAIL_IDENTIFIER, undefined, { services: [FADE], media });
        await walkToServices();

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        media.answer(Result.err(refusal));
        await elapseThenRealTime(10 * 60_000);

        expect(media.calls).toEqual([COVER.path]);
        expect(coverSrc()).toBeNull();
      },
    );
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

      expect(otpCalls).toHaveLength(1);
      const call = otpCalls[0];
      if (call?.otpCall !== 'COMPLETE') throw new Error('no registration');
      // The PIPELINE (not the form) fills the channel fallback.
      expect(call.fields.phone).toBe('+359888123456');
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
