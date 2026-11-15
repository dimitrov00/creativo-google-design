import { describe, expect, it } from 'vitest';
import {
  AccountsError,
  AccountsErrorCode,
  MediaError,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { AvatarSystem } from '@core/systems';
import { avatarUploadRefusal, barberPhotoRefusal } from './avatar-refusal';

/*
 * The one wording rule for a refused avatar upload: the picked file's own
 * refusal keeps its struct (today's words under `errors.<errorCode>`, its
 * own fields the params — pass D E-9), every Storage failure is today's one
 * upload-failed copy.
 */
describe('avatarUploadRefusal', () => {
  it('keeps the picked file’s own refusals', () => {
    expect(avatarUploadRefusal(AccountsError.uploadAvatarNotAnImage())).toEqual(
      { errorCode: 'ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE' },
    );
    expect(
      avatarUploadRefusal(
        AccountsError.uploadAvatarTooLarge(AvatarSystem.MAX_BYTES),
      ),
    ).toEqual({
      errorCode: 'ACCOUNTS_UPLOAD_AVATAR_TOO_LARGE',
      maxBytes: AvatarSystem.MAX_BYTES,
    });
  });

  it.each([
    ['transient', MediaError.transient('avatars/u/original')],
    ['forbidden', MediaError.forbidden('avatars/u/original')],
    ['not found', MediaError.notFound('avatars/u/original')],
  ] as const)(
    'words a %s Storage failure as the upload-failed copy',
    (_name, error) => {
      expect(avatarUploadRefusal(error)).toEqual(
        AccountsError.uploadAvatarUploadFailed(),
      );
      expect(AccountsErrorCode.UploadAvatarUploadFailed).toBe(
        'ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED',
      );
    },
  );
});

describe('barberPhotoRefusal — a barber’s own photo is the barber’s one photo', () => {
  const refused = (errorCode: string) =>
    PipelineError.fromWire('functions/permission-denied', { errorCode });

  it('a picture the shop does not show reads as "not an image"', () => {
    expect(barberPhotoRefusal(refused('TEAM_PHOTO_INVALID'))).toEqual(
      AccountsError.uploadAvatarNotAnImage(),
    );
  });

  it('a refusal of who may reads as the shop managing the photo', () => {
    for (const code of [
      'ACCESS_DENIED',
      'ACCESS_OWN_ONLY',
      'ACCESS_NOT_STAFF',
    ]) {
      expect(barberPhotoRefusal(refused(code)), code).toEqual(
        AccountsError.uploadAvatarShopManaged(),
      );
    }
  });

  it('everything else is the one upload-failed copy', () => {
    expect(barberPhotoRefusal(refused('TEAM_PHOTO_MISSING'))).toEqual(
      AccountsError.uploadAvatarUploadFailed(),
    );
    expect(
      barberPhotoRefusal(PipelineError.bare(PipelineErrorCode.Unavailable)),
    ).toEqual(AccountsError.uploadAvatarUploadFailed());
  });
});
