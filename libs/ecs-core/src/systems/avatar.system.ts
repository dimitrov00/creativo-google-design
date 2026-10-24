import { MediaRefusal, Result } from '@core/primitives';
import { AccountsError } from '@core/errors';
import { type MediaFile, MediaSystem } from './media.system';

/** 5 MiB — `storage.rules`' own avatar limit. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * THE AVATAR RULE (Phase 4a 4A-8) — what may be uploaded as a profile
 * photo, mirroring `storage.rules` so a bad file fails fast with a domain
 * refusal instead of a raw Storage permission-denied: an `image/*` content
 * type, under {@link AvatarSystem.MAX_BYTES} (the rules' `size < MAX` — a
 * file of exactly the limit is refused, pass C DEP-7). The guard itself is
 * `MediaSystem.check`, which the visit photo answers too; this system wraps
 * its neutral refusal in the avatar's own `AccountsError` codes.
 */
export const AvatarSystem = {
  MAX_BYTES,

  /**
   * `MediaSystem.check` against {@link MAX_BYTES}: the file's type first
   * (`ACCOUNTS_UPLOAD_AVATAR_NOT_AN_IMAGE`), then its size
   * (`ACCOUNTS_UPLOAD_AVATAR_TOO_LARGE`, carrying the limit). Takes a `Blob`
   * or `File` as it is.
   */
  check(file: MediaFile): Result<void, AccountsError> {
    const refusal = MediaSystem.check(file, MAX_BYTES);
    switch (refusal) {
      case null:
        return Result.ok(undefined);
      case MediaRefusal.NotAnImage:
        return Result.err(AccountsError.uploadAvatarNotAnImage());
      case MediaRefusal.TooLarge:
        return Result.err(AccountsError.uploadAvatarTooLarge(MAX_BYTES));
    }
  },
} as const;
