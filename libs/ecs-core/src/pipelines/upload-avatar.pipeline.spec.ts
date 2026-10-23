import { describe, expect, it } from 'vitest';
import type { StoredFile } from '@core/ports';
import { AccountsErrorCode, UserId } from '@core/primitives';
import { AvatarSystem } from '@core/systems';
import { memoryAvatarPorts } from '@core/testing';
import { uploadAvatar } from './upload-avatar.pipeline';

/*
 * The cases of `UploadAvatarUseCase`'s spec (the legacy accounts application
 * lib, deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1): the avatar rule before the upload, never touching Storage for a file
 * it refuses.
 */
const UID = UserId.of('user_1');

/** A blob-shaped file — its type and size are all the rule reads. */
const file = (type: string, size: number): Blob =>
  ({ type, size }) as unknown as Blob;

describe('uploadAvatar', () => {
  it('uploads a within-limit image', async () => {
    const avatars = new Map<UserId, StoredFile>();
    const result = await uploadAvatar(memoryAvatarPorts(avatars))(
      UID,
      file('image/jpeg', 10),
    );
    expect(result.ok).toBe(true);
    expect(avatars.has(UID)).toBe(true);
  });

  it('refuses a blob over the size limit without uploading', async () => {
    const avatars = new Map<UserId, StoredFile>();
    const result = await uploadAvatar(memoryAvatarPorts(avatars))(
      UID,
      file('image/jpeg', AvatarSystem.MAX_BYTES + 1),
    );
    expect(!result.ok && result.error.errorCode).toBe(
      AccountsErrorCode.UploadAvatarTooLarge,
    );
    expect(avatars.size).toBe(0);
  });

  it('refuses a non-image without uploading', async () => {
    const avatars = new Map<UserId, StoredFile>();
    const result = await uploadAvatar(memoryAvatarPorts(avatars))(
      UID,
      file('application/pdf', 10),
    );
    expect(!result.ok && result.error.errorCode).toBe(
      AccountsErrorCode.UploadAvatarNotAnImage,
    );
    expect(avatars.size).toBe(0);
  });
});
