import { User } from '@creativo/application/accounts';

/**
 * Profile-completion model for the dashboard nudge card — a pure
 * projection of the `User` aggregate, ported from v2's
 * `components/account/profile-completion.ts`. `name` and `phone` are
 * always set at registration (the "you've started" beat); `birthday` is
 * the one optional enhancement this pass can drive.
 *
 * v2's fourth item, `photo`, is dropped here: this codebase's `User`
 * aggregate carries no avatar/photo field yet (avatar upload exists as an
 * application use-case/port, but nothing persists a URL onto `User` —
 * that's 6.7 settings' job). Re-add a `photo` item once that field lands.
 */
export type ProfileCompletionKey = 'name' | 'phone' | 'birthday';

export interface ProfileCompletionItem {
  readonly key: ProfileCompletionKey;
  readonly done: boolean;
}

export interface ProfileCompletion {
  readonly items: readonly ProfileCompletionItem[];
  readonly done: number;
  readonly total: number;
  readonly complete: boolean;
}

export function profileCompletion(user: User): ProfileCompletion {
  const items: readonly ProfileCompletionItem[] = [
    { key: 'name', done: true },
    { key: 'phone', done: true },
    { key: 'birthday', done: user.birthDate !== null },
  ];
  const done = items.reduce((n, item) => n + (item.done ? 1 : 0), 0);
  return { items, done, total: items.length, complete: done === items.length };
}
