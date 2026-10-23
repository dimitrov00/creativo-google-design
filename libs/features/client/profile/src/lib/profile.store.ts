import { Injectable, inject, signal } from '@angular/core';
import { Principal, type ProfileEdits } from '@core/components';
import { uploadAvatar } from '@core/pipelines';
import {
  AccountsErrorCode,
  IdentityErrorCode,
  type UserId,
} from '@core/primitives';
import { AvatarSystem } from '@core/systems';
import {
  AccountStateService,
  saveOwnProfile,
} from '@creativo/features/client/account-state';
import {
  SessionIdentityService,
  avatarUploadRefusal,
} from '@creativo/features/shared/shell';
import {
  AVATAR_PORTS,
  GATEWAY_PORTS,
} from '@creativo/infrastructure/firebase-app';

/**
 * The write half of `/account/profile` — one place where an edit becomes a
 * persisted profile, so the screen itself only owns drafts and sheet state.
 *
 * Every method answers with an ERROR CODE or `null`, never a thrown error
 * or a raw domain object: the screen's single job on failure is to render
 * `translateDomainError(code)` and leave the sheet open with the draft
 * intact (same contract as onboarding's steps — a user's typing must never
 * silently vanish). A refused edit answers its ecs-core `errorCode`
 * (`ACCOUNTS_UPDATE_PROFILE_*`); every other failure answers
 * `AccountsErrorCode.UpdateProfileRepositoryFailure`
 * (`ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE`), and
 * an edit no active session owns `IDENTITY_IDENTIFIER_MISSING` — every
 * `errors.<errorCode>` key holds today's words.
 *
 * The write is the `updateProfile` callable (`saveOwnProfile`, Phase 4a
 * 4A-3 (2)): the server's `ProfileEditSystem.decide` judges the edit
 * against the stored profile on its own clock and writes the audit row in
 * the same transaction, credited to this user. The web no longer writes
 * `users/{uid}` (the rules refuse it).
 *
 * Component-provided, not root: drafts and pending state belong to one
 * visit of the screen.
 */
@Injectable()
export class ProfileStore {
  private readonly accountState = inject(AccountStateService);
  private readonly sessionIdentity = inject(SessionIdentityService);
  private readonly gateway = inject(GATEWAY_PORTS);
  private readonly avatars = inject(AVATAR_PORTS);
  private readonly upload = uploadAvatar(this.avatars);

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();

  /**
   * The signed-in user's id — the avatar owner `AVATAR_PORTS` names, and
   * the proof a profile edit has an owner — or `null` when there is no
   * active session.
   */
  private currentUserId(): UserId | null {
    const principal = this.accountState.principal();
    return Principal.isActive(principal) ? principal.userId : null;
  }

  /** The two trimmed names — `ProfileEditSystem` judges them (and trims again, the one rule). */
  async saveName(firstName: string, lastName: string): Promise<string | null> {
    return this.write({ firstName, lastName, birthDate: null });
  }

  /** `birthDate` is the `'YYYY-MM-DD'` the page's draft resolved to; the server re-judges it on its age day. */
  async saveBirthDate(birthDate: string): Promise<string | null> {
    return this.write({ firstName: null, lastName: null, birthDate });
  }

  private async write(edits: ProfileEdits): Promise<string | null> {
    if (!this.currentUserId()) return IdentityErrorCode.IdentifierMissing;

    this._pending.set(true);
    try {
      // No refresh: `account` is the live `users/{uid}` listener, so the
      // write reaches every screen that reads it on its own.
      return await saveOwnProfile(this.gateway, edits);
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
    const checked = AvatarSystem.check({
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!checked.ok) return checked.error.errorCode;
    const userId = this.currentUserId();
    if (!userId) return IdentityErrorCode.IdentifierMissing;

    this._pending.set(true);
    try {
      const result = await this.upload(userId, file);
      if (!result.ok) return avatarUploadRefusal(result.error);
      // The avatar is a storage object, not a `User` field — refreshing
      // the profile snapshot would prove nothing. This is what makes the
      // header circle and the menu portrait pick up the new face.
      this.sessionIdentity.refreshAvatar();
      return null;
    } finally {
      this._pending.set(false);
    }
  }

  /**
   * Drops the photo, returning the user to their monogram. No confirmation:
   * re-picking is one tap, and the monogram is the honest state anyway.
   */
  async removePhoto(): Promise<string | null> {
    const userId = this.currentUserId();
    if (!userId) return IdentityErrorCode.IdentifierMissing;

    this._pending.set(true);
    try {
      const result = await this.avatars.removeAvatar(userId);
      if (!result.ok) return AccountsErrorCode.RemoveAvatarRemoveFailed;
      this.sessionIdentity.refreshAvatar();
      return null;
    } finally {
      this._pending.set(false);
    }
  }
}
