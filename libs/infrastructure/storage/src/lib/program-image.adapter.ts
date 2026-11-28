import { type FirebaseStorage, getDownloadURL, ref } from 'firebase/storage';
import { Result } from '@core/primitives';
import type { ProgramImageResolvePorts } from '@core/ports';
import { ProgramImageSystem } from '@core/systems';
import { mediaErrorOf } from './storage-error-code';

/**
 * A description's pictures in Cloud Storage — `PROGRAM_IMAGE_RESOLVE_PORTS`
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 3): the address of the object a description names by its id
 * (`ProgramImageSystem.pathOf`). `media/` is fetched by anyone who holds a
 * path, so a visitor resolves it without a session. A failure is the one
 * Storage mapping (`mediaErrorOf`): not found and unauthorized are
 * permanent, everything else transient.
 */
export const programImageResolvePorts = (
  storage: FirebaseStorage,
): ProgramImageResolvePorts => ({
  resolveProgramImage: async (programId, imageId) => {
    const path = ProgramImageSystem.pathOf(programId, imageId);
    try {
      return Result.ok(await getDownloadURL(ref(storage, path)));
    } catch (cause) {
      return Result.err(mediaErrorOf(path, cause));
    }
  },
});
