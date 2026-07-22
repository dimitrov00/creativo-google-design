import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { UserId } from '@creativo/domain/accounts';
import { FIREBASE_STORAGE } from './storage.provider';

const { refMock, uploadBytesMock, getDownloadURLMock } = vi.hoisted(() => ({
  refMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadURLMock,
}));

import { FirebaseStorageAvatarUploader } from './avatar-uploader.adapter';

function makeUserId(): UserId {
  const result = UserId.create('user-1');
  if (result.isFailure()) throw new Error('unreachable');
  return result.value;
}

function makeBlob(type: string, size: number): Blob {
  return { type, size } as unknown as Blob;
}

function createUploader(): FirebaseStorageAvatarUploader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_STORAGE, useValue: {} },
      FirebaseStorageAvatarUploader,
    ],
  });
  return TestBed.inject(FirebaseStorageAvatarUploader);
}

describe('FirebaseStorageAvatarUploader', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uploads an image blob and returns its url/path', async () => {
    const fakeRef = { path: 'avatars/user-1/original' };
    refMock.mockReturnValue(fakeRef);
    uploadBytesMock.mockResolvedValue(undefined);
    getDownloadURLMock.mockResolvedValue('https://example.com/avatar.jpg');

    const uploader = createUploader();
    const result = await uploader.upload(
      makeUserId(),
      makeBlob('image/jpeg', 1024),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual({
        url: 'https://example.com/avatar.jpg',
        path: 'avatars/user-1/original',
      });
    }
    expect(uploadBytesMock).toHaveBeenCalledWith(fakeRef, expect.anything(), {
      contentType: 'image/jpeg',
    });
  });

  it('rejects a non-image content type before touching Storage', async () => {
    const uploader = createUploader();
    const result = await uploader.upload(
      makeUserId(),
      makeBlob('application/pdf', 1024),
    );

    expect(result.isFailure()).toBe(true);
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('rejects a blob over the 5 MiB limit before touching Storage', async () => {
    const uploader = createUploader();
    const result = await uploader.upload(
      makeUserId(),
      makeBlob('image/png', 6 * 1024 * 1024),
    );

    expect(result.isFailure()).toBe(true);
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('maps a Storage failure into a fail Result', async () => {
    refMock.mockReturnValue({});
    uploadBytesMock.mockRejectedValue(new Error('permission-denied'));

    const uploader = createUploader();
    const result = await uploader.upload(
      makeUserId(),
      makeBlob('image/png', 1024),
    );

    expect(result.isFailure()).toBe(true);
  });
});
