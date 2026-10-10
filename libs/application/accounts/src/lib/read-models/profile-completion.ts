import { User } from '@creativo/domain/accounts';
import { BirthDate, ProfileCompletionSystem } from '@creativo/ecs-core';

/**
 * Profile-completion model — a pure projection of the `User` aggregate
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
  // Same keys (the system's dictionary holds these strings), same order.
  return ProfileCompletionSystem.completion(profileOf(user), hasPhoto);
}

// ── The bridge: the legacy aggregate → ecs-core's slice (Phase 4 deletes it) ─

function profileOf(user: User): { readonly birthDate: BirthDate | null } {
  return {
    birthDate:
      user.birthDate === null ? null : BirthDate.of(user.birthDate.toISODate()),
  };
}
