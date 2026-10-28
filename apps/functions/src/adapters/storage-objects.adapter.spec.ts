import { RepositoryErrorCode } from '@core/errors';
import type { ObjectEraserPorts } from '@core/ports';
import { PRIVACY_SENTINELS } from '@core/testing';
import type { AdminBucket } from '../lib/firebase-admin';
import { storageObjectPorts } from './storage-objects.adapter';

/*
 * The erasure's Storage deletions (audit-hardening Phase 3, WS-D, §4 PD3)
 * over a fake bucket: one object deleted with `ignoreNotFound`; a prefix
 * LISTED, then each listed object deleted, the count the list's length;
 * a failure carries the canonical CODE and the path (ids only) — never the
 * SDK's message.
 */

type FakeFile = {
  readonly name: string;
  readonly delete: ReturnType<typeof vi.fn>;
};

type FakeBucket = {
  readonly objects: Map<string, FakeFile>;
  readonly file: ReturnType<typeof vi.fn>;
  readonly getFiles: ReturnType<typeof vi.fn>;
};

/** A bucket holding `paths`; deleting an object removes it (absent with `ignoreNotFound` is no failure). */
function fakeBucket(paths: readonly string[]): FakeBucket {
  const objects = new Map<string, FakeFile>();
  const fileOf = (name: string): FakeFile => {
    const file: FakeFile = {
      name,
      delete: vi.fn(async (options?: { readonly ignoreNotFound?: boolean }) => {
        if (!objects.has(name) && options?.ignoreNotFound !== true) {
          throw Object.assign(new Error(`No such object: ${name}`), {
            code: 404,
          });
        }
        objects.delete(name);
        return [{}];
      }),
    };
    return file;
  };
  for (const path of paths) objects.set(path, fileOf(path));
  return {
    objects,
    file: vi.fn((name: string) => objects.get(name) ?? fileOf(name)),
    getFiles: vi.fn(async (query: { readonly prefix: string }) => [
      [...objects.values()].filter((file) =>
        file.name.startsWith(query.prefix),
      ),
    ]),
  };
}

const asBucket = (bucket: FakeBucket): AdminBucket =>
  bucket as unknown as AdminBucket;

/** A Storage error as it is thrown, its message naming the person. */
const storageError = (code: string | number): Error =>
  Object.assign(
    new Error(`denied for ${PRIVACY_SENTINELS.email}: ${String(code)}`),
    { code },
  );

const SHOT = 'appointmentPhotos/appt-p-solo/photo-p-shot.jpg';
const AVATAR = 'avatars/u-erased/avatar.jpg';
const AVATAR_THUMB = 'avatars/u-erased/thumb.jpg';
const OTHER_AVATAR = 'avatars/u-erased-not/avatar.jpg';

describe('storage-objects adapter', () => {
  it('serves exactly ObjectEraserPorts', () => {
    const ports: ObjectEraserPorts = storageObjectPorts(
      asBucket(fakeBucket([])),
    );
    expect(Object.keys(ports).sort()).toEqual([
      'deleteStoredObject',
      'deleteStoredPrefix',
    ]);
  });

  describe('deleteStoredObject', () => {
    it('deletes the object at its path, ignoring one already gone', async () => {
      const bucket = fakeBucket([SHOT, AVATAR]);
      const ports = storageObjectPorts(asBucket(bucket));
      expect(await ports.deleteStoredObject(SHOT)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(bucket.file).toHaveBeenCalledWith(SHOT);
      expect([...bucket.objects.keys()]).toEqual([AVATAR]);
      // Again — the object is gone: done, never a failure (a resume).
      expect(await ports.deleteStoredObject(SHOT)).toEqual({
        ok: true,
        value: undefined,
      });
      for (const call of bucket.file.mock.results) {
        const file = call.value as FakeFile;
        for (const args of file.delete.mock.calls) {
          expect(args).toEqual([{ ignoreNotFound: true }]);
        }
      }
    });

    it('answers a failure as writeFailed(path, canonical code) — never the message', async () => {
      const bucket = fakeBucket([SHOT]);
      bucket.objects
        .get(SHOT)
        ?.delete.mockRejectedValueOnce(storageError('permission-denied'));
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredObject(SHOT);
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: SHOT,
          reason: 'permission-denied',
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.email);
    });
  });

  describe('deleteStoredPrefix', () => {
    it('lists the prefix, deletes each listed object and answers the list’s length', async () => {
      const bucket = fakeBucket([AVATAR, AVATAR_THUMB, OTHER_AVATAR, SHOT]);
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredPrefix('avatars/u-erased/');
      expect(result).toEqual({ ok: true, value: 2 });
      expect(bucket.getFiles).toHaveBeenCalledWith({
        prefix: 'avatars/u-erased/',
      });
      // Another uid sharing the text before the slash is not under the prefix.
      expect([...bucket.objects.keys()].sort()).toEqual(
        [OTHER_AVATAR, SHOT].sort(),
      );
    });

    it('answers 0 for an empty prefix — every call of a linked person runs it', async () => {
      const bucket = fakeBucket([SHOT]);
      expect(
        await storageObjectPorts(asBucket(bucket)).deleteStoredPrefix(
          'avatars/u-erased/',
        ),
      ).toEqual({ ok: true, value: 0 });
    });

    it('deletes each listed object with ignoreNotFound — one gone meanwhile is no failure', async () => {
      const bucket = fakeBucket([AVATAR, AVATAR_THUMB]);
      // Listed while both exist; one is gone before its delete runs.
      const listed = [...bucket.objects.values()];
      bucket.getFiles.mockResolvedValueOnce([listed]);
      bucket.objects.delete(AVATAR);
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredPrefix('avatars/u-erased/');
      expect(result).toEqual({ ok: true, value: 2 });
      for (const file of listed) {
        expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
      }
    });

    it('answers a failed listing as writeFailed(prefix, code)', async () => {
      const bucket = fakeBucket([AVATAR]);
      bucket.getFiles.mockRejectedValueOnce(storageError(14));
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredPrefix('avatars/u-erased/');
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'avatars/u-erased/',
          reason: 'unavailable',
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.email);
    });

    it('answers a failed deletion as writeFailed(prefix, code) — the next call deletes the rest', async () => {
      const bucket = fakeBucket([AVATAR, AVATAR_THUMB]);
      bucket.objects
        .get(AVATAR)
        ?.delete.mockRejectedValueOnce(storageError('auth/forbidden'));
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredPrefix('avatars/u-erased/');
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'avatars/u-erased/',
          reason: 'forbidden',
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.email);
    });
  });
});
