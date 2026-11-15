import { type FirebaseStorage, ref, uploadBytes } from 'firebase/storage';
import { Result } from '@core/primitives';
import type { StagedUploadPorts } from '@core/ports';
import { BarberPhotoSystem } from '@core/systems';
import { mediaErrorOf } from './storage-error-code';

/**
 * A picture staged for a callable — `STAGED_UPLOAD_PORTS`
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): the
 * bytes written to the account's own staging folder, the one path
 * `storage.rules` lets it write and nobody read
 * (`BarberPhotoSystem.stagedPathOf`). No guard here: the image type and the
 * 5 MiB limit are `BarberPhotoSystem.admitObject`'s, run by the
 * `changeBarberPhoto` pipeline BEFORE this call; whatever slips past it,
 * Storage itself refuses, answered `MEDIA_FORBIDDEN`. Nothing is read back:
 * a staged file has no download URL for anyone.
 */
export const stagedUploadPorts = (
  storage: FirebaseStorage,
): StagedUploadPorts => ({
  stageUpload: async (userId, stagedName, image) => {
    const path = BarberPhotoSystem.stagedPathOf(userId, stagedName);
    try {
      await uploadBytes(ref(storage, path), image, { contentType: image.type });
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(mediaErrorOf(path, cause));
    }
  },
});
