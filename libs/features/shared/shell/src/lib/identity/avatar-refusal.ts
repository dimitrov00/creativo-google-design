import {
  type AccountsError,
  AccountsErrorCode,
  type MediaError,
} from '@core/primitives';

/**
 * The words key for a failed avatar UPLOAD the store could not attribute to
 * the picked file — today's one copy for a Storage failure
 * (`errors.accounts.upload_avatar.upload_failed`).
 */
export const AVATAR_UPLOAD_FAILED = 'accounts.upload_avatar.upload_failed';

/** The words key for a failed avatar REMOVAL — today's one copy (`errors.accounts.remove_avatar.remove_failed`). */
export const AVATAR_REMOVE_FAILED = 'accounts.remove_avatar.remove_failed';

/**
 * The error code a person reads for a refused avatar upload
 * (`uploadAvatar`'s `AccountsError | MediaError`): the picked file's own
 * refusal (`ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE` / `_TOO_LARGE`, each
 * `errors.<errorCode>` holding today's words), every Storage failure the
 * one upload-failed copy, as the upload use case worded it. ONE rule for
 * every surface that uploads a person's own photo (the profile page and
 * onboarding's avatar step).
 */
export function avatarUploadRefusal(error: AccountsError | MediaError): string {
  return error.errorCode === AccountsErrorCode.UploadAvatarNotAnImage ||
    error.errorCode === AccountsErrorCode.UploadAvatarTooLarge
    ? error.errorCode
    : AVATAR_UPLOAD_FAILED;
}
