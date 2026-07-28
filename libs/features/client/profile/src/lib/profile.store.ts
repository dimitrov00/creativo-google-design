import { Injectable, inject, signal } from '@angular/core';
import {
  AVATAR_UPLOADER,
  MAX_AVATAR_BYTES,
  PROFILE_PORT,
  RemoveAvatarUseCase,
  UpdateProfileUseCase,
  UploadAvatarUseCase,
  UserId,
  FirstName,
  LastName,
  ZonedDateTime,
} from '@creativo/application/accounts';
import { Result } from '@creativo/application/identity';
import { CLOCK } from '@creativo/application/shared';
import { AccountStateService } from '@creativo/features/client/account-state';
import { SessionIdentityService } from '@creativo/features/shared/shell';

/**
 * The write half of `/account/profile` — one place where an edit becomes a
 * persisted profile, so the screen itself only owns drafts and sheet state.
 *
 * Every method answers with an ERROR CODE or `null`, never a thrown error
 * or a raw domain object: the screen's single job on failure is to render
 * `translateDomainError(code)` and leave the sheet open with the draft
 * intact (same contract as onboarding's steps — a user's typing must never
 * silently vanish).
 *
 * Component-provided, not root: drafts and pending state belong to one
 * visit of the screen.
 */
@Injectable()
export class ProfileStore {
  private readonly clock = inject(CLOCK);
  private readonly accountState = inject(AccountStateService);
  private readonly sessionIdentity = inject(SessionIdentityService);
  private readonly updateProfileUseCase = new UpdateProfileUseCase(
    inject(PROFILE_PORT),
  );
  private readonly uploadAvatarUseCase = new UploadAvatarUseCase(
    inject(AVATAR_UPLOADER),
  );
  private readonly removeAvatarUseCase = new RemoveAvatarUseCase(
    inject(AVATAR_UPLOADER),
  );

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();

  /**
   * Resolved once, from the CLOCK port rather than `new Date()` — the
   * birth-date age window is a domain rule evaluated against an explicit
   * instant (the same 'UTC' the onboarding store uses, matching the
   * server's own check).
   */
  private readonly today = (() => {
    const result = this.clock.now('UTC');
    return result.isSuccess() ? result.value : null;
  })();

  /** The signed-in user's id, or `null` when there is no active session. */
  private currentUserId(): UserId | null {
    const principal = this.accountState.principal();
    if (principal.kind !== 'active') return null;
    const result = UserId.create(principal.uid.value);
    return result.isSuccess() ? result.value : null;
  }

  async saveName(
    firstName: FirstName,
    lastName: LastName,
  ): Promise<string | null> {
    return this.write((userId, today) =>
      this.updateProfileUseCase.execute({
        userId,
        firstName,
        lastName,
        today,
      }),
    );
  }

  /** `birthDate` is an ISO calendar date the caller already validated through the identity `BirthDate` value object. */
  async saveBirthDate(birthDate: string): Promise<string | null> {
    return this.write((userId, today) =>
      this.updateProfileUseCase.execute({ userId, birthDate, today }),
    );
  }

  private async write<E extends { readonly code: string }>(
    run: (userId: UserId, today: ZonedDateTime) => Promise<Result<unknown, E>>,
  ): Promise<string | null> {
    const userId = this.currentUserId();
    if (!userId) return 'identifier_missing';
    // Unreachable in practice ('UTC' always resolves) — an honest code
    // beats a non-null assertion on a Result.
    if (!this.today) return 'accounts.update_profile.validation_failed';

    this._pending.set(true);
    try {
      const result = await run(userId, this.today);
      if (result.isFailure()) return result.error.code;
      // `ProfilePort` is one-shot, so the shared snapshot every other
      // screen reads is stale the moment this write lands.
      this.accountState.refresh();
      return null;
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
