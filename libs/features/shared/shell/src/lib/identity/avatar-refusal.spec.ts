import { describe, expect, it } from 'vitest';
import { AccountsError, MediaError } from '@core/primitives';
import { AvatarSystem } from '@core/systems';
import { AVATAR_UPLOAD_FAILED, avatarUploadRefusal } from './avatar-refusal';

/*
 * The one wording rule for a refused avatar upload: the picked file's own
 * refusal keeps its code (today's words under `errors.<errorCode>`), every
 * Storage failure is today's one upload-failed copy.
 */
describe('avatarUploadRefusal', () => {
  it('keeps the picked file’s own refusals', () => {
    expect(avatarUploadRefusal(AccountsError.uploadAvatarNotAnImage())).toBe(
      'ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE',
    );
    expect(
      avatarUploadRefusal(
        AccountsError.uploadAvatarTooLarge(AvatarSystem.MAX_BYTES),
      ),
    ).toBe('ACCOUNTS_UPLOAD_AVATAR_TOO_LARGE');
  });

  it.each([
    ['transient', MediaError.transient('avatars/u/original')],
    ['forbidden', MediaError.forbidden('avatars/u/original')],
    ['not found', MediaError.notFound('avatars/u/original')],
  ] as const)(
    'words a %s Storage failure as the upload-failed copy',
    (_name, error) => {
      expect(avatarUploadRefusal(error)).toBe(AVATAR_UPLOAD_FAILED);
      expect(AVATAR_UPLOAD_FAILED).toBe('accounts.upload_avatar.upload_failed');
    },
  );
});
