import { MediaRefusal } from '@core/primitives';

/**
 * What the guard reads of a file — its MIME type and its size in bytes: a
 * `Blob` or `File` as it is (zero inbound mapping), or any struct with the
 * two fields.
 */
export type MediaFile = Pick<Blob, 'type' | 'size'>;

/** 8 MiB — the largest visit photo the shop takes, after downscaling (`storage.rules`' photo limit). */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * MediaSystem — THE UPLOAD GUARD every upload answers before its bytes go up
 * (`media.port.ts`: limits are a guard before the upload, never the
 * adapter's), mirroring `storage.rules` so a bad file fails fast with a
 * domain refusal instead of a raw Storage permission-denied: an `image/*`
 * content type, and a size UNDER the limit — the rules' own `size < MAX`, so
 * a file of exactly the limit is refused here too (pass C, DEP-7; it used
 * to pass the client guard and meet Storage's denial).
 *
 * The answer is a NEUTRAL {@link MediaRefusal}; each upload wraps it in its
 * own error — the avatar (`AvatarSystem.check`, `ACCOUNTS_UPLOAD_AVATAR_*`)
 * and the visit photo (`attachVisitPhoto`, `MEDIA_PHOTO_*`). One home for the
 * rule the avatar and the staff day store each held.
 */
export const MediaSystem = {
  PHOTO_MAX_BYTES,

  /**
   * The file's type first (`NOT_AN_IMAGE` unless it starts `image/`), then
   * its size (`TOO_LARGE` at `maxBytes` or above); `null` lets it through.
   */
  check(file: MediaFile, maxBytes: number): MediaRefusal | null {
    if (!file.type.startsWith('image/')) return MediaRefusal.NotAnImage;
    if (file.size >= maxBytes) return MediaRefusal.TooLarge;
    return null;
  },
} as const;
