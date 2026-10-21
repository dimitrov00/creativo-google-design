import { describe, expect, it } from 'vitest';
import { BirthDate } from '@core/components';
import type { User } from '@core/entities';
import { registeredUserFixture } from '@core/testing';
import { profileCompletion } from './profile-completion';

/** A fresh registration — names and phone, optionally a birth date. */
function user(birthDate?: string): User {
  return registeredUserFixture({
    birthDate: birthDate === undefined ? null : BirthDate.of(birthDate),
  });
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

  it('keeps the lowercase keys the test ids, the i18n keys and the e2e selectors read', () => {
    expect(profileCompletion(user(), false).items.map((i) => i.key)).toEqual([
      'name',
      'phone',
      'birthday',
      'photo',
    ]);
  });
});
