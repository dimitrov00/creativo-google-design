import { DomainError } from '@creativo/domain/kernel';
import { AvatarUploadError } from '../ports/avatar-uploader.errors';

export class RemoveAvatarFailure extends DomainError {
  readonly code = 'accounts.remove_avatar.remove_failed' as const;
  constructor(public override readonly cause: AvatarUploadError) {
    super('Failed to remove the avatar');
  }
}

export type RemoveAvatarError = RemoveAvatarFailure;
