import { Injectable, inject, signal } from '@angular/core';
import {
  AVATAR_UPLOADER,
  MAX_AVATAR_BYTES,
  RemoveAvatarUseCase,
  UploadAvatarUseCase,
} from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import {
  AccountStateService,
  ageDayOf,
  saveOwnProfile,
} from '@creativo/features/client/account-state';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import { AccountsErrorCode, UserId } from '@core/primitives';
import type { ProfileEdits } from '@core/systems';

/**
 * The write half of `/account/profile` — one place where an edit becomes a
 * persisted profile, so the screen itself only owns drafts and sheet state.
 *
 * Every method answers with an ERROR CODE or `null`, never a thrown error
 * or a raw domain object: the screen's single job on failure is to render
 * `translateDomainError(code)` and leave the sheet open with the draft
 * intact (same contract as onboarding's steps — a user's typing must never
 * silently vanish). A refused edit answers its ecs-core `errorCode`
 * (`ACCOUNTS_UPDATE_PROFILE_*`); a failed store answers
 * `PROFILE_WRITE_FAILED` — both keys hold today's words.
 *
 * The write is `PROFILE_PORTS.writeOwnProfile` with
 * `ProfileEditSystem.decide` (identity flip (2), F2-6) — the same rule the
 * server's `updateProfile` runs — judged on the UTC civil day taken ONCE
 * from this store's `CLOCK` reading (F2-7).
 *
 * Component-provided, not root: drafts and pending state belong to one
 * visit of the screen.
 */
@Injectable()
export class ProfileStore {
  private readonly accountState = inject(AccountStateService);
  private readonly sessionIdentity = inject(SessionIdentityService);
  private readonly profilePorts = inject(PROFILE_PORTS);
  private readonly uploadAvatarUseCase = new UploadAvatarUseCase(
    inject(AVATAR_UPLOADER),
  );
  private readonly removeAvatarUseCase = new RemoveAvatarUseCase(
    inject(AVATAR_UPLOADER),
  );

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();

  /**
   * The day the birth-date age window is judged on — the UTC civil date,
   * resolved once from the CLOCK port rather than `new Date()` (the same
   * day the onboarding store and the server's own check use).
   */
  private readonly ageDay = ageDayOf(inject(CLOCK));

  /**
   * The signed-in user's id — the profile owner `saveOwnProfile` writes and
   * the avatar owner `AVATAR_UPLOADER` names — or `null` when there is no
   * active session.
   */
  private currentUserId(): UserId | null {
    const principal = this.accountState.principal();
    if (principal.kind !== 'active') return null;
    const result = UserId.parse(principal.uid.value);
    return result.ok ? result.value : null;
  }

  /** The two trimmed names — `ProfileEditSystem` judges them (and trims again, the one rule). */
  async saveName(firstName: string, lastName: string): Promise<string | null> {
    return this.write({ firstName, lastName, birthDate: null });
  }

  /** `birthDate` is the `'YYYY-MM-DD'` the page's draft resolved to; the edit re-judges it on the age day. */
  async saveBirthDate(birthDate: string): Promise<string | null> {
    return this.write({ firstName: null, lastName: null, birthDate });
  }

  private async write(edits: ProfileEdits): Promise<string | null> {
    const userId = this.currentUserId();
    if (!userId) return 'identifier_missing';
    // Unreachable in practice ('UTC' always resolves) — an honest code
    // beats a guessed day.
    if (!this.ageDay) return AccountsErrorCode.UpdateProfileValidationFailed;

    this._pending.set(true);
    try {
      // No refresh: `account` is the live `users/{uid}` listener, so the
      // write reaches every screen that reads it on its own.
      return await saveOwnProfile(
        this.profilePorts,
        userId,
        edits,
        this.ageDay,
      );
    } finally {
      this._pending.set(false);
    }
  }

  /**
   * The photo commits on pick — no sheet, no Save (Apple's grammar: for a
   * profile picture, choosing IS the commit). Mirrors the client-side
   * pre-checks the Storage rules enforce anyway, so a bad file fails fast
   * with a domain error instead of a raw permission-denied.
   */
  async uploadPhoto(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
      return 'accounts.upload_avatar.not_an_image';
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return 'accounts.upload_avatar.too_large';
    }
    const userId = this.currentUserId();
    if (!userId) return 'identifier_missing';

    this._pending.set(true);
    try {
      const result = await this.uploadAvatarUseCase.execute(userId, file);
      if (result.isFailure()) return result.error.code;
      // The avatar is a storage object, not a `User` field — refreshing
      // the profile snapshot would prove nothing. This is what makes the
      // header circle and the menu portrait pick up the new face.
      this.sessionIdentity.refreshAvatar();
      return null;
    } finally {
      this._pending.set(false);
    }
  }

  /** Drops the photo, returning the user to their monogram. No confirmation — see `RemoveAvatarUseCase`. */
  async removePhoto(): Promise<string | null> {
    const userId = this.currentUserId();
    if (!userId) return 'identifier_missing';

    this._pending.set(true);
    try {
      const result = await this.removeAvatarUseCase.execute(userId);
      if (result.isFailure()) return result.error.code;
      this.sessionIdentity.refreshAvatar();
      return null;
    } finally {
      this._pending.set(false);
    }
  }
}
