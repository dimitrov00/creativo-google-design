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
import { PROFILE_PORT, User } from '@creativo/application/accounts';
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
