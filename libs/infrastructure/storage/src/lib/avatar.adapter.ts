import {
  type FirebaseStorage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { Result } from '@core/primitives';
import type { AvatarPorts } from '@core/ports';
import { BarberPhotoSystem } from '@core/systems';
import { downscaleImage } from './downscale-image';
import {
  OBJECT_NOT_FOUND,
  mediaErrorOf,
  storageErrorCode,
} from './storage-error-code';

/**
 * A person's avatar in Cloud Storage — `AVATAR_PORTS` (Phase 4a §3.10; the
 * closure successor of the retired avatar-uploader class):
 * `avatars/{userId}/original` — one object per person, overwritten on
 * re-upload, `storage.rules`' single-object convention
 * (`BarberPhotoSystem.accountAvatarPathOf`, the path the server copies a
 * barber's photo to) — answered as the stored path and its download
 * URL. No guard here: the image type and the 5 MiB limit are
 * `AvatarSystem.check`'s, run by the `uploadAvatar` pipeline BEFORE this call
 * (`media.port.ts`); whatever slips past it, Storage itself refuses, answered
 * `MEDIA_FORBIDDEN`. Every failure is the one Storage mapping (`mediaErrorOf`).
 *
 * The picture goes up as every other one the app takes does
 * (`downscaleImage`: the long edge capped, the camera's orientation
 * applied), with its pixel size written beside the bytes as custom metadata
 * — `mediaWidth`, `mediaHeight`. That is what lets a barber record take a
 * newly linked account's avatar as its photo without the server opening
 * the file (`BarberPhotoSystem.adoptionOf`, one photo per barber, F6); a
 * picture the browser could not measure goes up without them, and is never
 * taken.
 */
export const avatarPorts = (storage: FirebaseStorage): AvatarPorts => ({
  uploadAvatar: async (userId, image) => {
    const path = BarberPhotoSystem.accountAvatarPathOf(userId);
    try {
      const object = ref(storage, path);
      const sized = await downscaleImage(image);
      await uploadBytes(object, sized.image, {
        contentType: sized.image.type,
        ...(sized.width !== null && sized.height !== null
          ? {
              customMetadata: {
                mediaWidth: String(sized.width),
                mediaHeight: String(sized.height),
              },
            }
          : {}),
      });
      return Result.ok({ path, url: await getDownloadURL(object) });
    } catch (cause) {
      return Result.err(mediaErrorOf(path, cause));
    }
  },

  findAvatar: async (userId) => {
    const path = BarberPhotoSystem.accountAvatarPathOf(userId);
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
    const path = BarberPhotoSystem.accountAvatarPathOf(userId);
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
