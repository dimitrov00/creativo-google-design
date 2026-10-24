import { Result, type UserId } from '@core/primitives';
import { type AccountsError, type MediaError } from '@core/errors';
import type { AvatarPorts, StoredFile } from '@core/ports';
import { AvatarSystem } from '@core/systems';

export type UploadAvatarPorts = AvatarPorts;

/**
 * A NEW PROFILE PHOTO (Phase 4a 4A-8): the avatar rule first
 * (`AvatarSystem.check` — an `image/*` file under 5 MiB, `MediaSystem.check`
 * wrapped in the avatar's codes), so a bad file fails
 * fast with its own refusal and never touches Storage; then the upload,
 * which replaces the person's one avatar object.
 */
export const uploadAvatar =
  (ports: UploadAvatarPorts) =>
  async (
    userId: UserId,
    image: Blob,
  ): Promise<Result<StoredFile, AccountsError | MediaError>> => {
    const checked = AvatarSystem.check(image);
    if (!checked.ok) return checked;
    return ports.uploadAvatar(userId, image);
  };
