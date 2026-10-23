import { describe, expect, it } from 'vitest';
import { AccountsErrorCode } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { AvatarSystem } from './avatar.system';

/*
 * The cases of `UploadAvatarUseCase`'s spec (the legacy accounts application
 * lib, deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1) and the Storage adapter's two guard cases
 * (`avatar-uploader.adapter.spec.ts`: a non-image type, a blob over 5 MiB), on
 * the one rule they shared.
 */
describe('AvatarSystem.check — what may be a profile photo', () => {
  it('takes an image within the limit', () => {
    expect(
      AvatarSystem.check({ contentType: 'image/jpeg', sizeBytes: 10 }).ok,
    ).toBe(true);
    expect(
      AvatarSystem.check({
        contentType: 'image/png',
        sizeBytes: AvatarSystem.MAX_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('refuses a non-image content type before its size', () => {
    expect(
      AvatarSystem.check({
        contentType: 'application/pdf',
        sizeBytes: AvatarSystem.MAX_BYTES + 1,
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: AccountsErrorCode.UploadAvatarNotAnImage },
    });
  });

  it('refuses a blob over the 5 MiB limit, naming the limit', () => {
    expect(AvatarSystem.MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(
      AvatarSystem.check({
        contentType: 'image/jpeg',
        sizeBytes: AvatarSystem.MAX_BYTES + 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        errorCode: AccountsErrorCode.UploadAvatarTooLarge,
        maxBytes: AvatarSystem.MAX_BYTES,
      },
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const file = deepFreeze({ contentType: 'image/webp', sizeBytes: 42 });
    expect(AvatarSystem.check(file)).toEqual(AvatarSystem.check(file));
  });
});
