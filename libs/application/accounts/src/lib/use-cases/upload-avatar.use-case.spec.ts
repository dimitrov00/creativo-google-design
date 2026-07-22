import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { AvatarRef, AvatarUploader } from '../ports/avatar-uploader.port';
import { AvatarUploadError } from '../ports/avatar-uploader.errors';
import {
  UploadAvatarUseCase,
  MAX_AVATAR_BYTES,
} from './upload-avatar.use-case';
import { AvatarTooLargeError } from './upload-avatar.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function fakeUploader(): AvatarUploader {
  return {
    async upload(): Promise<Result<AvatarRef, AvatarUploadError>> {
      return ok({
        url: 'https://cdn/avatars/user_1.jpg',
        path: 'avatars/user_1.jpg',
      });
    },
  };
}

describe('UploadAvatarUseCase', () => {
  it('uploads a within-limit blob', async () => {
    const useCase = new UploadAvatarUseCase(fakeUploader());
    const blob = new Blob(['x'.repeat(10)]);

    const result = await useCase.execute(
      requiredValue(UserId.create('user_1')),
      blob,
    );

    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a blob over the size limit', async () => {
    const useCase = new UploadAvatarUseCase(fakeUploader());
    const oversized = { size: MAX_AVATAR_BYTES + 1 } as Blob;

    const result = await useCase.execute(
      requiredValue(UserId.create('user_1')),
      oversized,
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(AvatarTooLargeError);
    }
  });
});
