import { AccountsError, Result } from '@core/primitives';

/** 5 MiB — `storage.rules`' own avatar limit. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * THE AVATAR RULE (Phase 4a 4A-8) — what may be uploaded as a profile
 * photo, mirroring `storage.rules` so a bad file fails fast with a domain
 * refusal instead of a raw Storage permission-denied: an `image/*` content
 * type, at most {@link AvatarSystem.MAX_BYTES}. One home for the rule the
 * Storage adapter and `UploadAvatarUseCase` each held (moved out of both).
 */
export const AvatarSystem = {
  MAX_BYTES,

  /** The file's type first (`ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE`), then its size (`…_TOO_LARGE`). */
  check(file: {
    readonly contentType: string;
    readonly sizeBytes: number;
  }): Result<void, AccountsError> {
    if (!file.contentType.startsWith('image/')) {
      return Result.err(AccountsError.uploadAvatarNotAnImage());
    }
    if (file.sizeBytes > MAX_BYTES) {
      return Result.err(AccountsError.uploadAvatarTooLarge(MAX_BYTES));
    }
    return Result.ok(undefined);
  },
} as const;
