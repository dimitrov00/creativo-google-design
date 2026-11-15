import {
  AccessErrorCode,
  AccountsError,
  AccountsErrorCode,
  type MediaError,
  type PipelineError,
  TeamErrorCode,
} from '@core/errors';
import { Tag } from '@core/primitives';

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
): AccountsError.AvatarRefusal {
  return error.errorCode === AccountsErrorCode.UploadAvatarNotAnImage ||
    error.errorCode === AccountsErrorCode.UploadAvatarTooLarge
    ? error
    : AccountsError.uploadAvatarUploadFailed();
}

/**
 * The refusal a BARBER reads for a refused upload of their own photo — the
 * barber's ONE photo, set through `setBarberPhoto`
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`), as
 * the same family of structs: a picture the shop does not show is "not an
 * image"; a refusal of who may (the owner's permissions do not let this
 * barber set it) is `ACCOUNTS_UPLOAD_AVATAR_SHOP_MANAGED`; everything else
 * the one upload-failed copy.
 */
export function barberPhotoRefusal(
  error: PipelineError,
): AccountsError.AvatarRefusal {
  if (error.serverErrorCode === TeamErrorCode.PhotoInvalid) {
    return AccountsError.uploadAvatarNotAnImage();
  }
  return Tag.has(AccessErrorCode, error.serverErrorCode)
    ? AccountsError.uploadAvatarShopManaged()
    : AccountsError.uploadAvatarUploadFailed();
}
