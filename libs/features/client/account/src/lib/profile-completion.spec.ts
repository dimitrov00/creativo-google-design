import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/application/identity';
import { User, ZonedDateTime } from '@creativo/application/accounts';
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
  it('marks name and phone done, birthday open, when no birth date is set', () => {
    const completion = profileCompletion(user());

    expect(completion.done).toBe(2);
    expect(completion.total).toBe(3);
    expect(completion.complete).toBe(false);
    expect(completion.items.find((i) => i.key === 'birthday')?.done).toBe(
      false,
    );
  });

  it('is complete once a birth date is set', () => {
    const completion = profileCompletion(user('2000-05-05'));

    expect(completion.done).toBe(3);
    expect(completion.complete).toBe(true);
  });
});
