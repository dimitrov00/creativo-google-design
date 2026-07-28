import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_GATEWAY,
  OTP_CLIENT,
  Result,
  ZonedDateTime,
  fail,
  ok,
  reconstituteIdentifier,
} from '@creativo/application/identity';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import {
  AVATAR_UPLOADER,
  PROFILE_PORT,
  User,
} from '@creativo/application/accounts';
import { OnboardingFlowStore } from './onboarding-flow.store';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const EMAIL_IDENTIFIER = reconstituteIdentifier({
  kind: 'email',
  value: 'client@example.com',
});

/** The just-registered profile `UpdateProfileUseCase` loads and rebuilds. */
function seededProfile(): User {
  const today = requiredValue(
    ZonedDateTime.fromISO('2026-07-25T12:00:00', 'UTC'),
  );
  return requiredValue(
    User.create(
      {
        id: 'uid_1',
        phone: '+359881234567',
        firstName: 'Ada',
        lastName: 'Lovelace',
        roles: ['client'],
        status: { kind: 'active' },
      },
      today,
    ),
  );
}

describe('OnboardingFlowStore — birthday step', () => {
  const completeRegistration = vi.fn();
  const getProfile = vi.fn();
  const saveProfile = vi.fn();
  let store: OnboardingFlowStore;

  beforeEach(() => {
    completeRegistration.mockReset().mockResolvedValue(ok(undefined));
    getProfile.mockReset().mockResolvedValue(ok(seededProfile()));
    saveProfile.mockReset().mockResolvedValue(ok(undefined));

    TestBed.configureTestingModule({
      providers: [
        OnboardingFlowStore,
        {
          // Frozen clock — the birthday age window must never read real time.
          provide: CLOCK,
          useValue: {
            now: (zone: string) =>
              ZonedDateTime.fromISO('2026-07-25T12:00:00', zone),
          },
        },
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () =>
              of({ kind: 'onboarding', uid: { value: 'uid_1' } }),
            currentIdentifier: () => EMAIL_IDENTIFIER,
            refreshToken: () => Promise.resolve(ok(undefined)),
            signOut: () => Promise.resolve(ok(undefined)),
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
        { provide: PROFILE_PORT, useValue: { getProfile, saveProfile } },
        {
          provide: AVATAR_UPLOADER,
          useValue: {
            upload: () =>
              Promise.resolve(ok({ url: 'http://avatar', path: 'avatars/x' })),
          },
        },
      ],
    });
    store = TestBed.inject(OnboardingFlowStore);
  });

  /** Registers and personalizes past services onto the birthday step. */
  async function walkToBirthday(): Promise<void> {
    await store.submitAbout({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+359881234567',
    });
    store.personalize();
    store.skipServices();
    expect(store.state().kind).toBe('birthday');
  }

  it('beginPersonalization enters the services step directly — the returning-active-account path (no About form, no network)', () => {
    store.beginPersonalization();

    expect(store.state().kind).toBe('services');
    expect(completeRegistration).not.toHaveBeenCalled();
  });

  it('a plan opens on its first step, with the earlier plan step still reachable via back', () => {
    store.beginPersonalization(['services', 'birthday']);

    expect(store.state().kind).toBe('services');
    store.skipServices();
    expect(store.state().kind).toBe('birthday');

    store.back();
    expect(store.state().kind).toBe('services');
  });

  it('steps OVER anything the profile already satisfies, forwards and backwards', () => {
    // Birthday already set elsewhere — this resume is services → avatar.
    store.beginPersonalization(['services', 'avatar']);
    expect(store.state().kind).toBe('services');

    store.skipServices();
    // The machine's next state is `birthday`; the plan skips it.
    expect(store.state().kind).toBe('avatar');

    store.back();
    // …and back doesn't land on it either, which would freeze the screen.
    expect(store.state().kind).toBe('services');
  });

  it('a single remaining step opens directly on it and reports itself as one screen', () => {
    store.beginPersonalization(['avatar']);

    expect(store.state().kind).toBe('avatar');
    expect(store.isSingleStep()).toBe(true);
    expect(store.plan()).toEqual(['avatar']);
    expect(store.planPosition()).toBe(1);
  });

  it('finishing the last planned step goes straight to entering, not to a redundant one', () => {
    store.beginPersonalization(['birthday']);
    expect(store.state().kind).toBe('birthday');

    store.skipBirthday();

    // Avatar is NOT in the plan (the photo is already there), so the flow
    // is done rather than asking for it again.
    expect(store.state().kind).toBe('entering');
  });

  it('submitBirthday persists the ISO date through UpdateProfileUseCase, then advances to avatar', async () => {
    await walkToBirthday();

    await store.submitBirthday({ day: 3, month: 7, year: 1990 });

    expect(saveProfile).toHaveBeenCalledTimes(1);
    const [savedUser] = saveProfile.mock.calls[0] as [User];
    expect(savedUser.birthDate?.toISODate()).toBe('1990-07-03');
    expect(store.state().kind).toBe('avatar');
  });

  it('skipBirthday advances to avatar without touching the profile port', async () => {
    await walkToBirthday();

    store.skipBirthday();

    expect(getProfile).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(store.state().kind).toBe('avatar');
  });

  it('rejects VO-invalid segments before the port is ever consulted', async () => {
    await walkToBirthday();

    await store.submitBirthday({ day: 30, month: 2, year: 1990 });

    expect(getProfile).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
    const state = store.state();
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.error).toBe('identity.birth_date.invalid');
    }
  });

  it('a failed save stays on the birthday step, carrying the stable error code', async () => {
    saveProfile.mockResolvedValue(fail(new RepositoryError('firestore down')));
    await walkToBirthday();

    await store.submitBirthday({ day: 3, month: 7, year: 1990 });

    const state = store.state();
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.error).toBe('accounts.update_profile.repository_failure');
    }
  });
});
