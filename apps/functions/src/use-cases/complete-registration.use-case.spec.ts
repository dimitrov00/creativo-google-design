import { UserId } from '@creativo/domain/models';
import {
  AuthTokenPort,
  UserRecordSnapshot,
  UserRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { ClockPort, RepositoryError } from '@creativo/application/shared';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import {
  InvalidBirthDateError,
  MissingRegistrationFieldError,
  RegistrationForbiddenError,
  UnauthenticatedError,
  UserNotFoundError,
} from './complete-registration.errors';
import { CompleteRegistrationUseCase } from './complete-registration.use-case';

/** Frozen clock — birth-date age validation must never read the real time. */
function fakeClock(iso = '2026-07-25T12:00:00'): ClockPort {
  return {
    now: (zone) => ZonedDateTime.fromISO(iso, zone),
  };
}

/** Raw doc mirror of the adapter's `users/{uid}` shape — `registered` derives from `firstName` presence exactly as `FirestoreUserRepository` does. */
interface StoredUserDoc {
  email: string | null;
  phone: string | null;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  status?: { kind: string };
  birthDate?: string | null;
}

function fakeUserRepository(): UserRepositoryPort & {
  store: Map<string, StoredUserDoc>;
} {
  const store = new Map<string, StoredUserDoc>();
  return {
    store,
    async provision(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, { email: user.email, phone: user.phone });
      return ok(undefined);
    },
    async saveRegistered(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, {
        email: user.email?.value ?? null,
        phone: user.phone.value,
        firstName: user.firstName.value,
        lastName: user.lastName.value,
        roles: [...user.roles],
        status: { kind: user.status.kind },
        birthDate: user.birthDate?.toISODate() ?? null,
      });
      return ok(undefined);
    },
    async findByDestination(
      destination,
    ): Promise<Result<UserRecordSnapshot | null, RepositoryError>> {
      const raw = otpDestinationValue(destination);
      for (const [id, doc] of store.entries()) {
        if (doc.email === raw || doc.phone === raw) {
          const idResult = UserId.create(id);
          if (idResult.isFailure())
            throw new Error('unexpected failure in test fixture');
          return ok({
            id: idResult.value,
            email: doc.email,
            phone: doc.phone,
            birthDate: doc.birthDate ?? null,
            registered: !!doc.firstName,
          });
        }
      }
      return ok(null);
    },
  };
}

function fakeAuthToken(): AuthTokenPort & {
  mintedTokens: Array<{ uid: string; claims: unknown }>;
} {
  const mintedTokens: Array<{ uid: string; claims: unknown }> = [];
  const displayNames: Array<{ uid: string; displayName: string }> = [];
  return {
    mintedTokens,
    displayNames,
    async createCustomToken(uid, _tenantId, claims) {
      mintedTokens.push({ uid: uid.value, claims });
      return ok(`token:${uid.value}`);
    },
    async setUserClaims() {
      throw new Error('not used by CompleteRegistrationUseCase');
    },
    async provisionAuthUser() {
      throw new Error('not used by CompleteRegistrationUseCase');
    },
    async setDisplayName(uid, displayName) {
      displayNames.push({ uid: uid.value, displayName });
      return ok(undefined);
    },
  };
}

/** Seeds the contact-channel stub `verifyOtpChallenge` provisions — no profile fields yet. */
function seedProvisioned(
  users: ReturnType<typeof fakeUserRepository>,
  phone: string,
): void {
  users.store.set('uid_1', { email: null, phone });
}

describe('CompleteRegistrationUseCase', () => {
  it('fills in the required profile fields and promotes claims to active', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Ada', lastName: 'Lovelace' },
      },
      'uid_1',
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.customToken).toBe('token:uid_1');
    }
    // Persisted as the full accounts-shape profile — the same document the
    // web's `FirestoreProfileAdapter` reconstitutes.
    expect(users.store.get('uid_1')).toEqual({
      email: null,
      phone: '+14155552671',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['client'],
      status: { kind: 'active' },
      birthDate: null,
    });
    expect(authToken.mintedTokens).toEqual([
      { uid: 'uid_1', claims: { stage: 'active', roles: ['client'] } },
    ]);
  });

  it('rejects when a required field (e.g. lastName) is missing', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Ada' },
      },
      'uid_1',
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(MissingRegistrationFieldError);
    }
    expect(authToken.mintedTokens).toHaveLength(0);
  });

  it('rejects when no provisioned user exists for the identifier', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Ada', lastName: 'Lovelace' },
      },
      'uid_1',
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(UserNotFoundError);
    }
  });

  it('rejects an unauthenticated caller — registration needs the verified session', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Ada', lastName: 'Lovelace' },
      },
      null,
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(UnauthenticatedError);
    }
    expect(authToken.mintedTokens).toHaveLength(0);
  });

  it('persists a valid optional birthDate on the user document', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          birthDate: '1990-07-03',
        },
      },
      'uid_1',
    );

    expect(result.isSuccess()).toBe(true);
    expect(users.store.get('uid_1')?.birthDate).toBe('1990-07-03');
  });

  it('registers exactly as before when birthDate is absent — nothing persisted, nothing rejected', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Ada', lastName: 'Lovelace' },
      },
      'uid_1',
    );

    expect(result.isSuccess()).toBe(true);
    expect(users.store.get('uid_1')?.birthDate).toBeNull();
    expect(authToken.mintedTokens).toHaveLength(1);
  });

  it('rejects an invalid birthDate with the typed, reason-carrying error — nothing minted, nothing saved', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    for (const [birthDate, reason] of [
      ['2030-01-01', 'identity.birth_date.in_future'],
      ['1990-02-30', 'identity.birth_date.invalid'],
      ['03.07.1990', 'identity.birth_date.invalid'],
      ['2020-01-01', 'identity.birth_date.too_young'],
    ] as const) {
      const result = await useCase.execute(
        {
          kind: 'phone',
          value: '+14155552671',
          fields: { firstName: 'Ada', lastName: 'Lovelace', birthDate },
        },
        'uid_1',
      );

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error).toBeInstanceOf(InvalidBirthDateError);
        if (result.error instanceof InvalidBirthDateError) {
          expect(result.error.code).toBe('registration_birth_date_invalid');
          expect(result.error.cause.code).toBe(reason);
        }
      }
    }
    expect(authToken.mintedTokens).toHaveLength(0);
    expect(users.store.get('uid_1')?.firstName).toBeUndefined();
  });

  it("refuses to complete a registration the caller's uid does not own", async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    seedProvisioned(users, '+14155552671');

    const useCase = new CompleteRegistrationUseCase(
      users,
      authToken,
      fakeClock(),
    );
    const result = await useCase.execute(
      {
        kind: 'phone',
        value: '+14155552671',
        fields: { firstName: 'Mallory', lastName: 'Intruder' },
      },
      'uid_someone_else',
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(RegistrationForbiddenError);
    }
    // Nothing minted, nothing overwritten — the provisioned stub stays
    // profile-less for the real owner to complete.
    expect(authToken.mintedTokens).toHaveLength(0);
    expect(users.store.get('uid_1')?.firstName).toBeUndefined();
  });
});
