import { type FirebaseStorage, getDownloadURL, ref } from 'firebase/storage';
import { Result } from '@core/primitives';
import type { MediaResolvePorts } from '@core/ports';
import { mediaErrorOf } from './storage-error-code';

/**
 * A catalogue image's renditions in Cloud Storage — `MEDIA_RESOLVE_PORTS`
 * (Phase 4a §3.10; the closure successor of the retired media-reader class). It
 * resolves the `MediaRef` the content service's `MediaRef.parse` guard produced
 * (a malformed stored ref never reaches Storage) to ONE servable rendition at
 * the ref's own width: `ref.mediaPath`'s download URL, `ref.mediaWidth` wide.
 * Deliberately one, not a stub: true multi-resolution `srcset` renditions need
 * an image-resizing pipeline that is not provisioned; when one lands this
 * adapter grows the extra width lookups without a port change. A failure is the
 * one Storage mapping (`mediaErrorOf`): not found and unauthorized are
 * permanent, everything else transient.
 */
export const mediaResolvePorts = (
  storage: FirebaseStorage,
): MediaResolvePorts => ({
  resolveMedia: async (media) => {
    try {
      const url = await getDownloadURL(ref(storage, media.mediaPath));
      return Result.ok([{ width: media.mediaWidth, url }]);
    } catch (cause) {
      return Result.err(mediaErrorOf(media.mediaPath, cause));
    }
  },
});
