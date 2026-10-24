/**
 * Why a file may not go up (`MediaSystem.check`): it is not an image, or it
 * is not under the size limit. NEUTRAL on purpose — never an avatar or a
 * photo code: each upload wraps the tag in its own error (the avatar in
 * `ACCOUNTS_UPLOAD_AVATAR_*`, the visit photo in `MEDIA_PHOTO_*`).
 */
export const MediaRefusal = {
  NotAnImage: 'NOT_AN_IMAGE',
  TooLarge: 'TOO_LARGE',
} as const;
export type MediaRefusal = (typeof MediaRefusal)[keyof typeof MediaRefusal];
