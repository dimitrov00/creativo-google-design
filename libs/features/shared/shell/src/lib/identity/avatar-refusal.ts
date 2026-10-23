import {
  type AccountsError,
  AccountsErrorCode,
  type MediaError,
} from '@core/primitives';

/**
 * The error code a person reads for a refused avatar upload
 * (`uploadAvatar`'s `AccountsError | MediaError`): the picked file's own
 * refusal (`ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE` / `_TOO_LARGE`, each
 * `errors.<errorCode>` holding today's words), every Storage failure the
 * one upload-failed copy (`AccountsErrorCode.UploadAvatarUploadFailed`,
 * `errors.ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED`), as the upload use case
 * worded it. ONE rule for
 * every surface that uploads a person's own photo (the profile page and
 * onboarding's avatar step).
 */
export function avatarUploadRefusal(error: AccountsError | MediaError): string {
  return error.errorCode === AccountsErrorCode.UploadAvatarNotAnImage ||
    error.errorCode === AccountsErrorCode.UploadAvatarTooLarge
    ? error.errorCode
    : AccountsErrorCode.UploadAvatarUploadFailed;
}
