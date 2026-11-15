import { Injectable, computed, inject, signal } from '@angular/core';
import { type BirthDate, Principal, type ProfileEdits } from '@core/components';
import {
  changeBarberPhoto,
  saveOwnProfile,
  uploadAvatar,
} from '@core/pipelines';
import { type BarberId, Result, type UserId } from '@core/primitives';
import {
  AccountsError,
  type AvatarUploadError,
  IdentityError,
  type OwnProfileWriteFailure,
} from '@core/errors';
import { AvatarSystem } from '@core/systems';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  SessionIdentityService,
  avatarUploadRefusal,
  barberPhotoRefusal,
} from '@creativo/features/shared/shell';
import {
  AVATAR_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  STAGED_UPLOAD_PORTS,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { downscaleImage } from '@creativo/infrastructure/storage';

/**
 * The write half of `/account/profile` — one place where an edit becomes a
 * persisted profile, so the screen itself only owns drafts and sheet state.
 *
 * Every method answers a `Result` whose refusal is the ERROR STRUCT (pass
 * D E-7), never a thrown error, a bare code or a raw domain object: the
 * screen's single job on failure is to render `translateCodedError(error)`
 * and leave the sheet open with the draft intact (same contract as
 * onboarding's steps — a user's typing must never silently vanish). A
 * refused edit answers its ecs-core struct (`ACCOUNTS_UPDATE_PROFILE_*`);
 * every other failure answers
 * `AccountsError.updateProfileRepositoryFailure()`
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
 * A BARBER'S photo is the shop's (one photo per barber, decision F7 of
 * `docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): for an
 * account linked to a barber record, picking a photo here sets the RECORD'S
 * photo through `setBarberPhoto` — the same call the Team page makes — and
 * the server copies it onto this account's avatar. There is no second
 * picture to keep in step, and none to remove here: `storage.rules` refuses
 * a linked account an avatar write of its own.
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
  private readonly changeRecordPhoto = changeBarberPhoto({
    ...inject(TEAM_ADMIN_PORTS),
    ...inject(STAGED_UPLOAD_PORTS),
    ...inject(ID_PORTS),
  });

  /**
   * Whether this account's photo is its barber record's — the account is
   * linked to one. The page then offers the one picker and no removal, and
   * says whose photo it is.
   */
  readonly photoIsBarbers = computed(
    () => this.sessionIdentity.linkedBarberId() !== null,
  );

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();
  /** A picked photo on its way up — the picker's own busy ring. */
  private readonly _photoPending = signal(false);
  readonly photoPending = this._photoPending.asReadonly();

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
  async saveName(
    firstName: string,
    lastName: string,
  ): Promise<Result<void, OwnProfileWriteFailure>> {
    return this.write({ firstName, lastName, birthDate: null });
  }

  /** `birthDate` is the day the page's draft resolved to (`AgeSystem.fromParts`); the server re-judges it on its age day. */
  async saveBirthDate(
    birthDate: BirthDate,
  ): Promise<Result<void, OwnProfileWriteFailure>> {
    return this.write({ firstName: null, lastName: null, birthDate });
  }

  private async write(
    edits: ProfileEdits,
  ): Promise<Result<void, OwnProfileWriteFailure>> {
    if (!this.currentUserId()) {
      return Result.err(IdentityError.identifierMissing());
    }

    this._pending.set(true);
    try {
      // No refresh: `account` is the live `users/{uid}` listener, so the
      // write reaches every screen that reads it on its own.
      return await saveOwnProfile(this.gateway)(edits);
    } finally {
      this._pending.set(false);
    }
  }

  /**
   * The photo commits on pick — no sheet, no Save (Apple's grammar: for a
   * profile picture, choosing IS the commit). Mirrors the client-side
   * pre-checks the Storage rules enforce anyway, so a bad file fails fast
   * with a domain error instead of a raw permission-denied. A linked
   * barber's pick goes to their record instead (`uploadBarberPhoto`).
   */
  async uploadPhoto(
    file: File,
  ): Promise<Result<void, AccountsError | AvatarUploadError>> {
    const checked = AvatarSystem.check(file);
    if (!checked.ok) return checked;
    const userId = this.currentUserId();
    if (!userId) return Result.err(IdentityError.identifierMissing());
    const barberId = this.sessionIdentity.linkedBarberId();

    this._pending.set(true);
    this._photoPending.set(true);
    try {
      if (barberId !== null) {
        const refusal = await this.uploadBarberPhoto(userId, barberId, file);
        if (refusal !== null) return Result.err(refusal);
        this.sessionIdentity.refreshAvatar();
        return Result.ok(undefined);
      }
      const result = await this.upload(userId, file);
      if (!result.ok) return Result.err(avatarUploadRefusal(result.error));
      // The avatar is a storage object, not a `User` field — refreshing
      // the profile snapshot would prove nothing. This is what makes the
      // header circle and the menu portrait pick up the new face.
      this.sessionIdentity.refreshAvatar();
      return Result.ok(undefined);
    } finally {
      this._pending.set(false);
      this._photoPending.set(false);
    }
  }

  /**
   * A linked barber's pick: the picture sized for the wire, then
   * `changeBarberPhoto` — staged under this account and handed to
   * `setBarberPhoto`, which judges who may (by default a barber sets their
   * own record's photo; the owner's permissions can say otherwise), sets
   * the record's photo and rewrites this account's avatar with it. `null`
   * once it landed; else the refusal as the person reads it.
   */
  private async uploadBarberPhoto(
    userId: UserId,
    barberId: BarberId,
    file: Blob,
  ): Promise<AccountsError.AvatarRefusal | null> {
    const sized = await downscaleImage(file);
    const answer = await this.changeRecordPhoto({
      userId,
      barberId,
      image: sized.image,
      mediaWidth: sized.width,
      mediaHeight: sized.height,
    });
    return answer.ok ? null : barberPhotoRefusal(answer.error);
  }

  /**
   * Drops the photo, returning the user to their monogram. No confirmation:
   * re-picking is one tap, and the monogram is the honest state anyway.
   */
  async removePhoto(): Promise<
    Result<
      void,
      AccountsError.RemoveAvatarRemoveFailed | IdentityError.IdentifierMissing
    >
  > {
    const userId = this.currentUserId();
    if (!userId) return Result.err(IdentityError.identifierMissing());

    this._pending.set(true);
    try {
      const result = await this.avatars.removeAvatar(userId);
      if (!result.ok) {
        return Result.err(AccountsError.removeAvatarRemoveFailed());
      }
      this.sessionIdentity.refreshAvatar();
      return Result.ok(undefined);
    } finally {
      this._pending.set(false);
    }
  }
}
