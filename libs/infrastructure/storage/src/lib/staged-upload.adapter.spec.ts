import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { UserId } from '@core/primitives';
import { MediaError } from '@core/errors';
import { unwrapErr } from '@core/testing';

const { refMock, uploadBytesMock } = vi.hoisted(() => ({
  refMock: vi.fn(),
  uploadBytesMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
}));

const { stagedUploadPorts } = await import('./staged-upload.adapter');

/*
 * A picture staged for a callable (the barber's photo): written to the
 * account's own staging folder, the one path `storage.rules` lets it write
 * and nobody read; nothing is read back.
 */

const STORAGE = { app: 'storage' } as unknown as FirebaseStorage;
const USER = UserId.of('u-editor');
const PATH = 'staffUploads/u-editor/a1b2c3d4-staged';

const picture = (type: string, size: number): Blob =>
  ({ type, size }) as unknown as Blob;

describe('stagedUploadPorts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uploads the picture under the account’s own staging folder, with its type', async () => {
    const fakeRef = { path: PATH };
    refMock.mockReturnValue(fakeRef);
    uploadBytesMock.mockResolvedValue(undefined);
    const image = picture('image/jpeg', 1024);

    const result = await stagedUploadPorts(STORAGE).stageUpload(
      USER,
      'a1b2c3d4-staged',
      image,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(refMock).toHaveBeenCalledWith(STORAGE, PATH);
    expect(uploadBytesMock).toHaveBeenCalledWith(fakeRef, image, {
      contentType: 'image/jpeg',
    });
  });

  it('answers what Storage refuses as MEDIA_FORBIDDEN, naming the path', async () => {
    refMock.mockReturnValue({ path: PATH });
    uploadBytesMock.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'storage/unauthorized' }),
    );

    const refusal = unwrapErr(
      await stagedUploadPorts(STORAGE).stageUpload(
        USER,
        'a1b2c3d4-staged',
        picture('image/jpeg', 1024),
      ),
    );

    expect(refusal).toEqual(MediaError.forbidden(PATH));
  });
});
