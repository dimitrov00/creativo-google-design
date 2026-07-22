import { DomainError } from '@creativo/domain/kernel';
import { AvatarUploadError } from '../ports/avatar-uploader.errors';

export class AvatarTooLargeError extends DomainError {
  readonly code = 'accounts.upload_avatar.too_large' as const;
  constructor(
    public readonly sizeBytes: number,
    public readonly maxBytes: number,
  ) {
    super(`Avatar (${sizeBytes} bytes) exceeds the ${maxBytes}-byte limit`, {
      sizeBytes,
      maxBytes,
    });
  }
}

export class UploadAvatarFailure extends DomainError {
  readonly code = 'accounts.upload_avatar.upload_failed' as const;
  constructor(public override readonly cause: AvatarUploadError) {
    super('Failed to upload the avatar');
  }
}

export type UploadAvatarError = AvatarTooLargeError | UploadAvatarFailure;
