import { describe, expect, it } from 'vitest';
import { AccountsErrorCode } from '@core/errors';
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
    expect(AvatarSystem.check({ type: 'image/jpeg', size: 10 }).ok).toBe(true);
    expect(
      AvatarSystem.check({
        type: 'image/png',
        size: AvatarSystem.MAX_BYTES - 1,
      }).ok,
    ).toBe(true);
  });

  it('refuses a non-image content type before its size', () => {
    expect(
      AvatarSystem.check({
        type: 'application/pdf',
        size: AvatarSystem.MAX_BYTES + 1,
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
        type: 'image/jpeg',
        size: AvatarSystem.MAX_BYTES + 1,
      }),
    ).toEqual({
      ok: false,
      error: {
        errorCode: AccountsErrorCode.UploadAvatarTooLarge,
        maxBytes: AvatarSystem.MAX_BYTES,
      },
    });
  });

  // Pass C DEP-7: `storage.rules` takes `size < MAX`, so a file of exactly
  // the limit is refused here too (it used to pass and meet Storage's denial).
  it('refuses a blob of exactly the limit, as storage.rules does', () => {
    expect(
      AvatarSystem.check({ type: 'image/png', size: AvatarSystem.MAX_BYTES }),
    ).toEqual({
      ok: false,
      error: {
        errorCode: AccountsErrorCode.UploadAvatarTooLarge,
        maxBytes: AvatarSystem.MAX_BYTES,
      },
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const file = deepFreeze({ type: 'image/webp', size: 42 });
    expect(AvatarSystem.check(file)).toEqual(AvatarSystem.check(file));
  });
});
