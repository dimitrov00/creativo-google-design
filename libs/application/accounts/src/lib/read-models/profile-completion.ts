import type { User } from '@core/entities';
import {
  ProfileCompletionKey as CompletionKey,
  ProfileCompletionSystem,
} from '@core/systems';

/**
 * Profile-completion model — a pure projection of the flat `User` of
 * `@core/entities` (identity flip (2): the `users/{uid}` body as stored)
 * plus the storage-side avatar answer (ported from v2's
 * `components/account/profile-completion.ts`, `photo` item restored
 * 2026-07-27 now that `AvatarUploader.find` can answer it). `name` and
 * `phone` are always set at registration (the "you've started" beat);
 * `birthday` and `photo` are the optional enhancements the nudge drives.
 *
 * Lives in the application layer rather than beside the dashboard because
 * two surfaces now read it: the `/account` completion card and the shell
 * menu's linear "finish your profile" row. One definition of "complete",
 * one item order — the menu and the card can never disagree about what is
 * still missing.
 */
export type ProfileCompletionKey = 'name' | 'phone' | 'birthday' | 'photo';

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

export function profileCompletion(
  user: User,
  hasPhoto: boolean,
): ProfileCompletion {
  // Same items, same order — the system's; each key back in this file's
  // lowercase spelling.
  const completion = ProfileCompletionSystem.completion(user, hasPhoto);
  return {
    items: completion.items.map((item) => ({
      key: LEGACY_PROFILE_COMPLETION_KEY[item.profileCompletionKey],
      done: item.done,
    })),
    done: completion.done,
    total: completion.total,
    complete: completion.complete,
  };
}

// ── The bridge: the system's keys → this file's (Phase 4 deletes it) ────────

/**
 * The system's SCREAMING key → this file's lowercase key (flatten-spec §8.9)
 * — kept lowercase on purpose: the `account-completion-<key>` test ids, the
 * `account.completion.items.<key>` i18n keys and the e2e selectors read it.
 */
const LEGACY_PROFILE_COMPLETION_KEY = {
  [CompletionKey.Name]: 'name',
  [CompletionKey.Phone]: 'phone',
  [CompletionKey.Birthday]: 'birthday',
  [CompletionKey.Photo]: 'photo',
} as const satisfies { readonly [K in CompletionKey]: ProfileCompletionKey };
