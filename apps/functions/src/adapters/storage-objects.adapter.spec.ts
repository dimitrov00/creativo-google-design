import { RepositoryErrorCode } from '@core/errors';
import type { ObjectEraserPorts } from '@core/ports';
import { PRIVACY_SENTINELS } from '@core/testing';
import type { AdminBucket } from '../lib/firebase-admin';
import { storageObjectPorts } from './storage-objects.adapter';

/*
 * The erasure's Storage writes (audit-hardening Phase 3, WS-D, §4 PD3) over
 * a fake bucket: one object deleted with `ignoreNotFound`; a prefix LISTED,
 * then each listed object deleted, the count the list's length; a KEPT
 * object's `clientLabel` custom metadata removed, every other key kept (a
 * `LIBRARY` photo's picture, P3-DEP-31); a failure carries the canonical
 * CODE and the path (ids only) — never the SDK's message.
 */

type FakeFile = {
  readonly name: string;
  readonly delete: ReturnType<typeof vi.fn>;
  readonly getMetadata: ReturnType<typeof vi.fn>;
  readonly setMetadata: ReturnType<typeof vi.fn>;
};

type FakeBucket = {
  readonly objects: Map<string, FakeFile>;
  /** Each object's custom metadata (`metadata.metadata`), by path. */
  readonly custom: Map<string, Record<string, string>>;
  readonly file: ReturnType<typeof vi.fn>;
  readonly getFiles: ReturnType<typeof vi.fn>;
};

const noSuchObject = (name: string): Error =>
  Object.assign(new Error(`No such object: ${name}`), { code: 404 });

/**
 * A bucket holding `paths`; deleting an object removes it (absent with
 * `ignoreNotFound` is no failure); its custom metadata read and patched as
 * the JSON API does — a key set to `null` is removed, the rest merged.
 */
function fakeBucket(
  paths: readonly string[],
  custom: Readonly<Record<string, Record<string, string>>> = {},
): FakeBucket {
  const objects = new Map<string, FakeFile>();
  const metadata = new Map<string, Record<string, string>>(
    Object.entries(custom).map(([path, keys]) => [path, { ...keys }]),
  );
  const fileOf = (name: string): FakeFile => {
    const file: FakeFile = {
      name,
      delete: vi.fn(async (options?: { readonly ignoreNotFound?: boolean }) => {
        if (!objects.has(name) && options?.ignoreNotFound !== true) {
          throw noSuchObject(name);
        }
        objects.delete(name);
        metadata.delete(name);
        return [{}];
      }),
      getMetadata: vi.fn(async () => {
        if (!objects.has(name)) throw noSuchObject(name);
        const keys = metadata.get(name);
        return [keys === undefined ? { name } : { name, metadata: keys }];
      }),
      setMetadata: vi.fn(
        async (patch: {
          readonly metadata: Readonly<Record<string, string | null>>;
        }) => {
          if (!objects.has(name)) throw noSuchObject(name);
          const merged = new Map(Object.entries(metadata.get(name) ?? {}));
          for (const [key, value] of Object.entries(patch.metadata)) {
            if (value === null) merged.delete(key);
            else merged.set(key, value);
          }
          const next = Object.fromEntries(merged);
          metadata.set(name, next);
          return [{ name, metadata: next }];
        },
      ),
    };
    return file;
  };
  for (const path of paths) objects.set(path, fileOf(path));
  return {
    objects,
    custom: metadata,
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

const SHOT = 'appointmentPhotos/appt-p-solo/photo-p-shot';
const LIBRARY = 'appointmentPhotos/appt-q-party/photo-p-library';
const AVATAR = 'avatars/u-erased/avatar.jpg';
const AVATAR_THUMB = 'avatars/u-erased/thumb.jpg';
const OTHER_AVATAR = 'avatars/u-erased-not/avatar.jpg';

describe('storage-objects adapter', () => {
  it('serves exactly ObjectEraserPorts', () => {
    const ports: ObjectEraserPorts = storageObjectPorts(
      asBucket(fakeBucket([])),
    );
    expect(Object.keys(ports).sort()).toEqual([
      'clearStoredLabel',
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

  describe('clearStoredLabel', () => {
    it('removes the clientLabel key of a KEPT object — the object stays, every other key kept', async () => {
      const bucket = fakeBucket([LIBRARY, SHOT], {
        [LIBRARY]: {
          clientLabel: PRIVACY_SENTINELS.label,
          appointmentId: 'appt-q-party',
        },
        [SHOT]: { clientLabel: 'Other Label' },
      });
      const ports = storageObjectPorts(asBucket(bucket));
      expect(await ports.clearStoredLabel(LIBRARY)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(bucket.objects.has(LIBRARY)).toBe(true);
      expect(bucket.custom.get(LIBRARY)).toEqual({
        appointmentId: 'appt-q-party',
      });
      const file = bucket.objects.get(LIBRARY);
      expect(file?.setMetadata).toHaveBeenCalledWith({
        metadata: { clientLabel: null },
      });
      // Another object's label is untouched.
      expect(bucket.custom.get(SHOT)).toEqual({ clientLabel: 'Other Label' });
    });

    it('is idempotent: an object without the label (or an empty one) writes nothing; no object at the path is done', async () => {
      const bucket = fakeBucket([LIBRARY, SHOT], {
        [SHOT]: { clientLabel: '' },
      });
      const ports = storageObjectPorts(asBucket(bucket));
      for (const path of [LIBRARY, SHOT, 'media/services/gone.jpg']) {
        expect(await ports.clearStoredLabel(path), path).toEqual({
          ok: true,
          value: undefined,
        });
      }
      for (const file of bucket.objects.values()) {
        expect(file.setMetadata).not.toHaveBeenCalled();
      }
      expect([...bucket.objects.keys()].sort()).toEqual([LIBRARY, SHOT].sort());
    });

    it('answers a failure as writeFailed(path, canonical code) — never the message', async () => {
      const bucket = fakeBucket([LIBRARY], {
        [LIBRARY]: { clientLabel: PRIVACY_SENTINELS.label },
      });
      bucket.objects
        .get(LIBRARY)
        ?.setMetadata.mockRejectedValueOnce(storageError('permission-denied'));
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).clearStoredLabel(LIBRARY);
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: LIBRARY,
          reason: 'permission-denied',
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.email);
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.label);
    });

    it('answers a path the SDK refuses to name as a failure, never a throw', async () => {
      const bucket = fakeBucket([]);
      bucket.file.mockImplementationOnce(() => {
        throw Object.assign(new Error('A file name must be specified.'), {
          code: 'storage/invalid-argument',
        });
      });
      expect(
        await storageObjectPorts(asBucket(bucket)).clearStoredLabel(''),
      ).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: '',
          reason: 'invalid-argument',
        },
      });
    });
  });
});
