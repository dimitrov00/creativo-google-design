import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BirthDate } from '../components/birth-date.data';
import { deepFreeze } from '../testing';
import {
  ProfileCompletionKey,
  ProfileCompletionSystem,
} from './profile-completion.system';

/*
 * The cases of libs/application/accounts/src/lib/read-models/
 * profile-completion.spec.ts, COPIED and re-targeted: `profileCompletion(
 * user, hasPhoto)` → `ProfileCompletionSystem.completion(profile,
 * hasPhoto)` over the plain `birthDate` field. The read-model spec keeps
 * running until its file is shimmed (cross-group).
 */

const user = (birthDate: string | null = null) => ({
  birthDate: birthDate === null ? null : BirthDate.of(birthDate),
});

describe('ProfileCompletionSystem.completion', () => {
  it('marks name and phone done, birthday and photo open, for a fresh registration', () => {
    const completion = ProfileCompletionSystem.completion(user(), false);

    expect(completion.done).toBe(2);
    expect(completion.total).toBe(4);
    expect(completion.complete).toBe(false);
    expect(
      completion.items.find((i) => i.key === ProfileCompletionKey.Birthday)
        ?.done,
    ).toBe(false);
    expect(
      completion.items.find((i) => i.key === ProfileCompletionKey.Photo)?.done,
    ).toBe(false);
  });

  it('is complete once a birth date is set AND a photo exists', () => {
    expect(
      ProfileCompletionSystem.completion(user('2000-05-05'), false).complete,
    ).toBe(false);
    expect(ProfileCompletionSystem.completion(user(), true).complete).toBe(
      false,
    );

    const completion = ProfileCompletionSystem.completion(
      user('2000-05-05'),
      true,
    );
    expect(completion.done).toBe(4);
    expect(completion.complete).toBe(true);
  });

  it('lists the items in one fixed order — the card and the menu never disagree', () => {
    expect(
      ProfileCompletionSystem.completion(user(), false).items.map((i) => i.key),
    ).toEqual([
      ProfileCompletionKey.Name,
      ProfileCompletionKey.Phone,
      ProfileCompletionKey.Birthday,
      ProfileCompletionKey.Photo,
    ]);
  });
});

describe('ProfileCompletionSystem properties', () => {
  it('done counts the done items, and complete means all of them', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasBirthday, hasPhoto) => {
        const completion = ProfileCompletionSystem.completion(
          user(hasBirthday ? '1990-01-01' : null),
          hasPhoto,
        );
        expect(completion.done).toBe(
          completion.items.filter((i) => i.done).length,
        );
        expect(completion.complete).toBe(hasBirthday && hasPhoto);
      }),
    );
  });
});

describe('ProfileCompletionSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const profile = deepFreeze(user('2000-05-05'));
    const once = ProfileCompletionSystem.completion(profile, true);
    const twice = ProfileCompletionSystem.completion(profile, true);
    expect(twice).toEqual(once);
    expect(profile).toEqual(user('2000-05-05'));
  });
});
