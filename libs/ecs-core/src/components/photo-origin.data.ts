/** The origin tags — the dictionary named after the field `photoOrigin`. */
const PHOTO_ORIGIN = {
  Shot: 'SHOT',
  Library: 'LIBRARY',
} as const;

/**
 * Where an appointment photo's bytes came from — the photo's field
 * `photoOrigin` (was `origin`, N15):
 *
 * - `SHOT` — taken for this visit by the staff camera; the photo owns its
 *   Storage object under `appointmentPhotos/{appointmentId}/…`.
 * - `LIBRARY` — a picture adopted from the shop's own library; the photo
 *   only points at the library object, which belongs to the shop.
 *
 * Load-bearing: deleting a photo removes its Storage object **only** for
 * `SHOT` (`deleteAppointmentPhoto`, `appointment-photos.adapter.ts`), so the
 * shop's library picture is never deleted with a visit's reference to it.
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
} as const;
