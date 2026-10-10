import type { UserEntity } from '../entities/user.entity';

/**
 * ProfileCompletionSystem — how complete a profile is (blueprint §2.8), the
 * pure port of `libs/application/accounts/src/lib/read-models/
 * profile-completion.ts`. One definition of "complete" and one item order,
 * read by the `/account` completion card and the shell menu's "finish your
 * profile" row, so the two can never disagree about what is still missing.
 *
 * `name` and `phone` are always set at registration (the "you've started"
 * beat); `birthday` and `photo` are the optional enhancements the nudge
 * drives. The photo answer comes from storage, so it is a parameter.
 */
export const ProfileCompletionKey = {
  Name: 'name',
  Phone: 'phone',
  Birthday: 'birthday',
  Photo: 'photo',
} as const;
export type ProfileCompletionKey =
  (typeof ProfileCompletionKey)[keyof typeof ProfileCompletionKey];

export type ProfileCompletionItem = {
  readonly key: ProfileCompletionKey;
  readonly done: boolean;
};

export type ProfileCompletion = {
  readonly items: readonly ProfileCompletionItem[];
  readonly done: number;
  readonly total: number;
  readonly complete: boolean;
};

export const ProfileCompletionSystem = {
  completion(
    profile: Pick<UserEntity, 'birthDate'>,
    hasPhoto: boolean,
  ): ProfileCompletion {
    const items: readonly ProfileCompletionItem[] = [
      { key: ProfileCompletionKey.Name, done: true },
      { key: ProfileCompletionKey.Phone, done: true },
      { key: ProfileCompletionKey.Birthday, done: profile.birthDate !== null },
      { key: ProfileCompletionKey.Photo, done: hasPhoto },
    ];
    let done = 0;
    for (let i = 0; i < items.length; i++) {
      if ((items[i] as ProfileCompletionItem).done) done++;
    }
    return {
      items,
      done,
      total: items.length,
      complete: done === items.length,
    };
  },
} as const;
