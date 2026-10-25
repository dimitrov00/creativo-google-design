import {
  AccountsError,
  AccountsErrorCode,
  type MediaError,
} from '@core/errors';

/**
 * The refusal a person reads for a refused avatar upload
 * (`uploadAvatar`'s `AccountsError | MediaError`), as its struct (pass D
 * E-9): the picked file's own refusal (`ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE`
 * / `_TOO_LARGE`, each `errors.<errorCode>` holding today's words), every
 * Storage failure the one upload-failed copy
 * (`AccountsError.uploadAvatarUploadFailed()`,
 * `errors.ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED`), as the upload use case
 * worded it. ONE rule for every surface that uploads a person's own photo
 * (the profile page and onboarding's avatar step).
 */
export function avatarUploadRefusal(
  error: AccountsError | MediaError,
):
  | AccountsError.UploadAvatarNotAnImage
  | AccountsError.UploadAvatarTooLarge
  | AccountsError.UploadAvatarUploadFailed {
  return error.errorCode === AccountsErrorCode.UploadAvatarNotAnImage ||
    error.errorCode === AccountsErrorCode.UploadAvatarTooLarge
    ? error
    : AccountsError.uploadAvatarUploadFailed();
}
