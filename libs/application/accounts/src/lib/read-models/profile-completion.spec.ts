import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { User } from '@creativo/domain/accounts';
import { profileCompletion } from './profile-completion';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
);

function user(birthDate?: string): User {
  return requiredValue(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
        birthDate,
      },
      TODAY,
    ),
  );
}

describe('profileCompletion', () => {
  it('marks name and phone done, birthday and photo open, for a fresh registration', () => {
    const completion = profileCompletion(user(), false);

    expect(completion.done).toBe(2);
    expect(completion.total).toBe(4);
    expect(completion.complete).toBe(false);
    expect(completion.items.find((i) => i.key === 'birthday')?.done).toBe(
      false,
    );
    expect(completion.items.find((i) => i.key === 'photo')?.done).toBe(false);
  });

  it('is complete once a birth date is set AND a photo exists', () => {
    expect(profileCompletion(user('2000-05-05'), false).complete).toBe(false);
    expect(profileCompletion(user(), true).complete).toBe(false);

    const completion = profileCompletion(user('2000-05-05'), true);
    expect(completion.done).toBe(4);
    expect(completion.complete).toBe(true);
  });
});
