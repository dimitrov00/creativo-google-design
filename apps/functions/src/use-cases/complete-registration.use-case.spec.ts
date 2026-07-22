import { User } from '@creativo/domain/models';
import {
  AuthTokenPort,
  UserRepositoryPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { RepositoryError } from '@creativo/application/shared';
import { Result, ok } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import {
  MissingRegistrationFieldError,
  UserNotFoundError,
} from './complete-registration.errors';
import { CompleteRegistrationUseCase } from './complete-registration.use-case';

function fakeUserRepository(): UserRepositoryPort & {
  store: Map<string, User>;
} {
  const store = new Map<string, User>();
  return {
    store,
    async save(user): Promise<Result<void, RepositoryError>> {
      store.set(user.id.value, user);
      return ok(undefined);
    },
    async findByDestination(
      destination,
    ): Promise<Result<User | null, RepositoryError>> {
      const raw = otpDestinationValue(destination);
      for (const user of store.values()) {
        if (user.email?.value === raw || user.phone === raw) return ok(user);
      }
      return ok(null);
    },
  };
}

function fakeAuthToken(): AuthTokenPort & {
  mintedTokens: Array<{ uid: string; claims: unknown }>;
} {
  const mintedTokens: Array<{ uid: string; claims: unknown }> = [];
  return {
    mintedTokens,
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
  };
}

function provisionedUser(phone: string): User {
  const result = User.create({
    id: 'uid_1',
    phone,
    referralCode: 'REF12345',
    gamificationPoints: 0,
    tenantMemberships: [],
  });
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('CompleteRegistrationUseCase', () => {
  it('fills in the required profile fields and promotes claims to active', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    await users.save(provisionedUser('+14155552671'));

    const useCase = new CompleteRegistrationUseCase(users, authToken);
    const result = await useCase.execute({
      kind: 'phone',
      value: '+14155552671',
      fields: { firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.customToken).toBe('token:uid_1');
    }
    const saved = users.store.get('uid_1');
    expect(saved?.displayName).toBe('Ada Lovelace');
    expect(authToken.mintedTokens).toEqual([
      { uid: 'uid_1', claims: { stage: 'active', roles: ['client'] } },
    ]);
  });

  it('rejects when a required field (e.g. lastName) is missing', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();
    await users.save(provisionedUser('+14155552671'));

    const useCase = new CompleteRegistrationUseCase(users, authToken);
    const result = await useCase.execute({
      kind: 'phone',
      value: '+14155552671',
      fields: { firstName: 'Ada' },
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(MissingRegistrationFieldError);
    }
    expect(authToken.mintedTokens).toHaveLength(0);
  });

  it('rejects when no provisioned user exists for the identifier', async () => {
    const users = fakeUserRepository();
    const authToken = fakeAuthToken();

    const useCase = new CompleteRegistrationUseCase(users, authToken);
    const result = await useCase.execute({
      kind: 'phone',
      value: '+14155552671',
      fields: { firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(UserNotFoundError);
    }
  });
});
