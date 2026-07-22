import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { FirstName, LastName, User, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { ProfilePort } from '../ports/profile.port';
import { UpdateProfileUseCase } from './update-profile.use-case';
import { ProfileNotFoundError } from './update-profile.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
);

function user(): User {
  return requiredValue(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
      },
      TODAY,
    ),
  );
}

function fakeProfiles(seed: User | null): ProfilePort & { saved: User[] } {
  const saved: User[] = [];
  let current = seed;
  return {
    saved,
    async getProfile(): Promise<Result<User | null, RepositoryError>> {
      return ok(current);
    },
    async saveProfile(u): Promise<Result<void, RepositoryError>> {
      saved.push(u);
      current = u;
      return ok(undefined);
    },
  };
}

describe('UpdateProfileUseCase', () => {
  it('rebuilds and saves the profile with the new name', async () => {
    const profiles = fakeProfiles(user());
    const useCase = new UpdateProfileUseCase(profiles);

    const result = await useCase.execute({
      userId: requiredValue(UserId.create('user_1')),
      firstName: requiredValue(FirstName.create('Janet')),
      lastName: requiredValue(LastName.create('Doeson')),
      today: TODAY,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.firstName.value).toBe('Janet');
      expect(result.value.lastName.value).toBe('Doeson');
    }
    expect(profiles.saved).toHaveLength(1);
  });

  it('reports not-found for an unknown user', async () => {
    const profiles = fakeProfiles(null);
    const useCase = new UpdateProfileUseCase(profiles);

    const result = await useCase.execute({
      userId: requiredValue(UserId.create('nope')),
      firstName: requiredValue(FirstName.create('Janet')),
      lastName: requiredValue(LastName.create('Doeson')),
      today: TODAY,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(ProfileNotFoundError);
    }
  });
});
