import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { Email, User, UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { ProfilePort } from '../ports/profile.port';
import {
  ContactChangePort,
  ContactChangeRequestId,
} from '../ports/contact-change.port';
import { ContactChangeError } from '../ports/contact-change.errors';
import { ConfirmationCode } from '../ports/confirmation-code';
import { ConfirmContactChangeUseCase } from './confirm-contact-change.use-case';

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

function fakeContactChange(): ContactChangePort {
  return {
    async requestChange(): Promise<
      Result<ContactChangeRequestId, ContactChangeError>
    > {
      return ok('req_1' as ContactChangeRequestId);
    },
    async confirmChange(): Promise<Result<void, ContactChangeError>> {
      return ok(undefined);
    },
  };
}

function fakeProfiles(seed: User): ProfilePort & { saved: User[] } {
  const saved: User[] = [];
  return {
    saved,
    async getProfile(): Promise<Result<User | null, RepositoryError>> {
      return ok(seed);
    },
    async saveProfile(u): Promise<Result<void, RepositoryError>> {
      saved.push(u);
      return ok(undefined);
    },
  };
}

describe('ConfirmContactChangeUseCase', () => {
  it('confirms the change and saves the profile with the new email', async () => {
    const profiles = fakeProfiles(user());
    const useCase = new ConfirmContactChangeUseCase(
      fakeContactChange(),
      profiles,
    );

    const result = await useCase.execute({
      userId: requiredValue(UserId.create('user_1')),
      requestId: 'req_1' as ContactChangeRequestId,
      code: requiredValue(ConfirmationCode.create('123456')),
      target: {
        kind: 'email',
        email: requiredValue(Email.create('new@example.com')),
      },
      today: TODAY,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.email?.value).toBe('new@example.com');
    }
    expect(profiles.saved).toHaveLength(1);
  });
});
