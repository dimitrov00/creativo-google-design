import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { MediaError, UserId } from '@core/primitives';
import { unwrapErr, unwrapOk } from '@core/testing';

const { refMock, uploadBytesMock, getDownloadURLMock, deleteObjectMock } =
  vi.hoisted(() => ({
    refMock: vi.fn(),
    uploadBytesMock: vi.fn(),
    getDownloadURLMock: vi.fn(),
    deleteObjectMock: vi.fn(),
  }));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadURLMock,
  deleteObject: deleteObjectMock,
}));

const { avatarPorts } = await import('./avatar.adapter');

const STORAGE = { app: 'storage' } as unknown as FirebaseStorage;
const USER = UserId.of('user-1');
const PATH = 'avatars/user-1/original';

function makeBlob(type: string, size: number): Blob {
  return { type, size } as unknown as Blob;
}

describe('avatarPorts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uploads an image blob to the person’s one object and answers its path and url', async () => {
    const fakeRef = { path: PATH };
    refMock.mockReturnValue(fakeRef);
    uploadBytesMock.mockResolvedValue(undefined);
    getDownloadURLMock.mockResolvedValue('https://example.com/avatar.jpg');

    const result = await avatarPorts(STORAGE).uploadAvatar(
      USER,
      makeBlob('image/jpeg', 1024),
    );

    expect(unwrapOk(result)).toEqual({
      path: PATH,
      url: 'https://example.com/avatar.jpg',
    });
    expect(refMock).toHaveBeenCalledWith(STORAGE, PATH);
    expect(uploadBytesMock).toHaveBeenCalledWith(fakeRef, expect.anything(), {
      contentType: 'image/jpeg',
    });
  });

  // The guard left the adapter (4A-8): the type and the 5 MiB limit are
  // `AvatarSystem.check`'s, run by the `uploadAvatar` pipeline first.
  // Whatever slips past it, Storage refuses — permanent, never retried.
  it('answers Storage’s own refusal as MEDIA_FORBIDDEN', async () => {
    refMock.mockReturnValue({});
    uploadBytesMock.mockRejectedValue({ code: 'storage/unauthorized' });

    const failure = unwrapErr(
      await avatarPorts(STORAGE).uploadAvatar(
        USER,
        makeBlob('application/pdf', 1024),
      ),
    );

    expect(failure).toEqual(MediaError.forbidden(PATH));
  });

  it('maps any other Storage failure to a transient MediaError', async () => {
    refMock.mockReturnValue({});
    uploadBytesMock.mockRejectedValue(new Error('network'));

    const failure = unwrapErr(
      await avatarPorts(STORAGE).uploadAvatar(
        USER,
        makeBlob('image/png', 1024),
      ),
    );

    expect(failure).toEqual(MediaError.transient(PATH));
  });

  it('finds the person’s avatar', async () => {
    refMock.mockReturnValue({ path: PATH });
    getDownloadURLMock.mockResolvedValue('https://example.com/avatar.jpg');

    expect(unwrapOk(await avatarPorts(STORAGE).findAvatar(USER))).toEqual({
      path: PATH,
      url: 'https://example.com/avatar.jpg',
    });
  });

  it('reads no object as no avatar yet — an answer, not a failure', async () => {
    refMock.mockReturnValue({ path: PATH });
    getDownloadURLMock.mockRejectedValue({ code: 'storage/object-not-found' });

    expect(unwrapOk(await avatarPorts(STORAGE).findAvatar(USER))).toBeNull();
  });

  it('surfaces a real storage failure on find', async () => {
    refMock.mockReturnValue({ path: PATH });
    getDownloadURLMock.mockRejectedValue({
      code: 'storage/retry-limit-exceeded',
    });

    expect(unwrapErr(await avatarPorts(STORAGE).findAvatar(USER))).toEqual(
      MediaError.transient(PATH),
    );
  });

  it('removes the avatar object', async () => {
    refMock.mockReturnValue({ path: PATH });
    deleteObjectMock.mockResolvedValue(undefined);

    const result = await avatarPorts(STORAGE).removeAvatar(USER);

    expect(result.ok).toBe(true);
    expect(deleteObjectMock).toHaveBeenCalledTimes(1);
  });

  it('treats removing a non-existent avatar as success — the end state is what the caller wanted', async () => {
    refMock.mockReturnValue({ path: PATH });
    deleteObjectMock.mockRejectedValue({ code: 'storage/object-not-found' });

    expect((await avatarPorts(STORAGE).removeAvatar(USER)).ok).toBe(true);
  });

  it('surfaces a real storage failure on remove', async () => {
    refMock.mockReturnValue({ path: PATH });
    deleteObjectMock.mockRejectedValue({ code: 'storage/unauthorized' });

    expect(unwrapErr(await avatarPorts(STORAGE).removeAvatar(USER))).toEqual(
      MediaError.forbidden(PATH),
    );
  });
});
