import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { AvatarUploader } from '../ports/avatar-uploader.port';
import { RemoveAvatarError, RemoveAvatarFailure } from './remove-avatar.errors';

/**
 * Drops a user's profile photo — the counterpart to `UploadAvatarUseCase`,
 * and the reason "Remove photo" can exist as a real menu action rather
 * than a promise the app can't keep.
 *
 * There is deliberately no confirmation step anywhere in this path. HIG
 * reserves that friction for destructive actions that lose information the
 * user entered (WWDC20: "destructive actions often cause you to lose
 * information you've entered… we want to make sure there's enough
 * friction"); a profile photo is one tap to put back, so a confirm dialog
 * would be ceremony, not safety.
 */
export class RemoveAvatarUseCase {
  constructor(private readonly uploader: AvatarUploader) {}

  async execute(userId: UserId): Promise<Result<void, RemoveAvatarError>> {
    const result = await this.uploader.remove(userId);
    if (result.isFailure()) {
      return fail(new RemoveAvatarFailure(result.error));
    }
    return ok(undefined);
  }
}
