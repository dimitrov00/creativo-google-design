import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { AvatarRef, AvatarUploader } from '../ports/avatar-uploader.port';
import {
  AvatarTooLargeError,
  UploadAvatarError,
  UploadAvatarFailure,
} from './upload-avatar.errors';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MiB

export class UploadAvatarUseCase {
  constructor(private readonly uploader: AvatarUploader) {}

  async execute(
    userId: UserId,
    data: Blob,
  ): Promise<Result<AvatarRef, UploadAvatarError>> {
    if (data.size > MAX_AVATAR_BYTES) {
      return fail(new AvatarTooLargeError(data.size, MAX_AVATAR_BYTES));
    }

    const uploadResult = await this.uploader.upload(userId, data);
    if (uploadResult.isFailure()) {
      return fail(new UploadAvatarFailure(uploadResult.error));
    }

    return ok(uploadResult.value);
  }
}
