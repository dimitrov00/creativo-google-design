import { Injectable, inject } from '@angular/core';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  AvatarRef,
  AvatarUploader,
  AvatarUploadError,
} from '@creativo/application/accounts';
import { FIREBASE_STORAGE } from './storage.provider';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * One object per user (`avatars/{userId}/original`), overwritten on
 * re-upload — matches the single-object convention in `storage.rules`.
 * Client-side pre-checks mirror the rule's own 5 MiB / `image/*`
 * constraints so a bad upload fails fast with a domain error instead of a
 * raw Storage permission-denied.
 */
@Injectable()
export class FirebaseStorageAvatarUploader implements AvatarUploader {
  private readonly storage = inject(FIREBASE_STORAGE);

  async upload(
    userId: UserId,
    data: Blob,
  ): Promise<Result<AvatarRef, AvatarUploadError>> {
    if (!data.type.startsWith('image/')) {
      return fail(
        new AvatarUploadError(`"${data.type}" is not an image content type`),
      );
    }
    if (data.size > MAX_AVATAR_BYTES) {
      return fail(
        new AvatarUploadError(
          `Avatar is ${data.size} bytes, exceeds the ${MAX_AVATAR_BYTES}-byte limit`,
        ),
      );
    }

    const path = `avatars/${userId.value}/original`;
    try {
      const objectRef = ref(this.storage, path);
      await uploadBytes(objectRef, data, { contentType: data.type });
      const url = await getDownloadURL(objectRef);
      return ok({ url, path });
    } catch (error) {
      return fail(new AvatarUploadError('Failed to upload avatar', error));
    }
  }

  async find(
    userId: UserId,
  ): Promise<Result<AvatarRef | null, AvatarUploadError>> {
    const path = `avatars/${userId.value}/original`;
    try {
      const url = await getDownloadURL(ref(this.storage, path));
      return ok({ url, path });
    } catch (error) {
      // Absence is an ANSWER, not a failure — the single-object convention
      // means "no such object" simply reads as "no avatar yet".
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'storage/object-not-found'
      ) {
        return ok(null);
      }
      return fail(new AvatarUploadError('Failed to look up avatar', error));
    }
  }

  async remove(userId: UserId): Promise<Result<void, AvatarUploadError>> {
    const path = `avatars/${userId.value}/original`;
    try {
      await deleteObject(ref(this.storage, path));
      return ok(undefined);
    } catch (error) {
      // Idempotent by the port's contract: deleting an avatar that isn't
      // there already achieved what the caller wanted. Only a REAL storage
      // failure (permissions, network) is an error.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'storage/object-not-found'
      ) {
        return ok(undefined);
      }
      return fail(new AvatarUploadError('Failed to remove avatar', error));
    }
  }
}
