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
}

export const AVATAR_UPLOADER = new InjectionToken<AvatarUploader>(
  'AvatarUploader',
);
