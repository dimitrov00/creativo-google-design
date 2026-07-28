import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { AvatarUploadError } from './avatar-uploader.errors';

/** Where the uploaded avatar can be read back from. Storage-agnostic on purpose — the concrete Firebase Storage adapter lands in Goal 04. */
export interface AvatarRef {
  readonly url: string;
  readonly path: string;
}

export interface AvatarUploader {
  /** `data` is a raw image blob — genuinely not a domain concept, so it stays unbranded; `userId` (whose avatar this is) is. */
  upload(
    userId: UserId,
    data: Blob,
  ): Promise<Result<AvatarRef, AvatarUploadError>>;

  /** Whether (and where) this user's avatar exists — `null` when none was ever uploaded. The single-object convention makes existence a storage lookup, not a profile field. */
  find(userId: UserId): Promise<Result<AvatarRef | null, AvatarUploadError>>;

  /**
   * Drops this user's avatar, returning them to the monogram. Idempotent
   * by contract — removing an avatar that isn't there SUCCEEDS, because
   * "there is no avatar" is the caller's desired end state either way
   * (same reasoning as `find` treating absence as an answer, not a
   * failure).
   */
  remove(userId: UserId): Promise<Result<void, AvatarUploadError>>;
}

export const AVATAR_UPLOADER = new InjectionToken<AvatarUploader>(
  'AvatarUploader',
);
