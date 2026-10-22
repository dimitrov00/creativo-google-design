import {
  type FirebaseStorage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { Result, type UserId } from '@core/primitives';
import type { AvatarPorts } from '@core/ports';
import {
  OBJECT_NOT_FOUND,
  mediaErrorOf,
  storageErrorCode,
} from './storage-error-code';

/** One object per person, overwritten on re-upload — `storage.rules`' single-object convention. */
const avatarPath = (userId: UserId): string => `avatars/${userId}/original`;

/**
 * A person's avatar in Cloud Storage — `AVATAR_PORTS` (Phase 4a §3.10; the
 * closure successor of the retired avatar-uploader class):
 * `avatars/{userId}/original`, answered as the stored path and its download
 * URL. No guard here: the image type and the 5 MiB limit are
 * `AvatarSystem.check`'s, run by the `uploadAvatar` pipeline BEFORE this call
 * (`media.port.ts`); whatever slips past it, Storage itself refuses, answered
 * `MEDIA_FORBIDDEN`. Every failure is the one Storage mapping (`mediaErrorOf`).
 */
export const avatarPorts = (storage: FirebaseStorage): AvatarPorts => ({
  uploadAvatar: async (userId, image) => {
    const path = avatarPath(userId);
    try {
      const object = ref(storage, path);
      await uploadBytes(object, image, { contentType: image.type });
      return Result.ok({ path, url: await getDownloadURL(object) });
    } catch (cause) {
      return Result.err(mediaErrorOf(path, cause));
    }
  },

  findAvatar: async (userId) => {
    const path = avatarPath(userId);
    try {
      return Result.ok({ path, url: await getDownloadURL(ref(storage, path)) });
    } catch (cause) {
      // Absence is an ANSWER, not a failure — the single-object convention
      // means "no such object" simply reads as "no avatar yet".
      return storageErrorCode(cause) === OBJECT_NOT_FOUND
        ? Result.ok(null)
        : Result.err(mediaErrorOf(path, cause));
    }
  },

  removeAvatar: async (userId) => {
    const path = avatarPath(userId);
    try {
      await deleteObject(ref(storage, path));
      return Result.ok(undefined);
    } catch (cause) {
      // Idempotent: removing an avatar that is not there already achieved
      // what the caller wanted. Only a REAL storage failure (permissions,
      // network) is an error.
      return storageErrorCode(cause) === OBJECT_NOT_FOUND
        ? Result.ok(undefined)
        : Result.err(mediaErrorOf(path, cause));
    }
  },
});
