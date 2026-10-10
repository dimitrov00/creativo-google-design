/** The stored origin tags — the tag source of {@link PhotoOrigin}. */
const PHOTO_ORIGIN = {
  Shot: 'shot',
  Library: 'library',
} as const;

/**
 * Where an appointment photo's bytes came from — the stored
 * `appointmentPhotos.origin` (`appointment-photos.adapter.ts:131,157`):
 *
 * - `shot` — taken for this visit by the staff camera; the photo owns its
 *   Storage object under `appointmentPhotos/{appointmentId}/…`.
 * - `library` — a picture adopted from the shop's own library; the photo
 *   only points at the library object, which belongs to the shop.
 *
 * Load-bearing: deleting a photo removes its Storage object **only** for
 * `shot` (`:176`), so the shop's library picture is never deleted with a
 * visit's reference to it.
 */
export type PhotoOrigin = (typeof PHOTO_ORIGIN)[keyof typeof PHOTO_ORIGIN];

export const PhotoOrigin = {
  ...PHOTO_ORIGIN,

  /**
   * Whether deleting the photo also deletes its Storage object — only a
   * photo shot for the visit owns its bytes.
   */
  ownsBytes(origin: PhotoOrigin): boolean {
    return origin === PHOTO_ORIGIN.Shot;
  },

  /**
   * The edge guard for a stored value, exactly as the reader resolves it
   * today (`appointment-photos.adapter.ts:234`): `'library'` is a library
   * picture, and anything else — including a document written before the
   * field existed — is a shot. A library object is only ever named
   * explicitly.
   */
  parse(raw: unknown): PhotoOrigin {
    return raw === PHOTO_ORIGIN.Library
      ? PHOTO_ORIGIN.Library
      : PHOTO_ORIGIN.Shot;
  },
} as const;
