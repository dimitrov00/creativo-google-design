import { RepositoryErrorCode } from '@core/errors';
import type { ObjectEraserPorts } from '@core/ports';
import { PRIVACY_SENTINELS } from '@core/testing';
import type { AdminBucket } from '../lib/firebase-admin';
import {
  storageObjectPorts,
  storedObjectCopyPorts,
} from './storage-objects.adapter';

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
        ?.delete.mockRejectedValueOnce(
          storageError('storage/permission-denied'),
        );
      const result = await storageObjectPorts(
        asBucket(bucket),
      ).deleteStoredPrefix('avatars/u-erased/');
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'avatars/u-erased/',
          reason: 'permission-denied',
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

/*
 * The barber photo's Storage reads and copies (`setBarberPhoto`,
 * `docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`) over a
 * fake bucket: an object's size and type, `null` for none; one object
 * copied onto another path; a failure carries the canonical CODE and the
 * path — never the SDK's message.
 */
describe('storage-objects adapter — the photo’s stat and copy', () => {
  type Stored = { readonly size: unknown; readonly contentType?: unknown };

  /** A bucket of `{ path: metadata }`; `failing` paths throw as Storage does. */
  function photoBucket(
    stored: Readonly<Record<string, Stored>>,
    failing: readonly string[] = [],
  ) {
    const objects = new Map<string, Stored>(Object.entries(stored));
    const copies: string[] = [];
    const fileOf = (name: string) => ({
      name,
      getMetadata: vi.fn(async () => {
        if (failing.includes(name)) throw storageError('storage/internal');
        const held = objects.get(name);
        if (held === undefined) throw noSuchObject(name);
        return [{ name, ...held }];
      }),
      copy: vi.fn(async (target: { readonly name: string }) => {
        if (failing.includes(target.name)) throw storageError(503);
        const held = objects.get(name);
        if (held === undefined) throw noSuchObject(name);
        objects.set(target.name, held);
        copies.push(`${name}→${target.name}`);
        return [{}];
      }),
    });
    return {
      objects,
      copies,
      bucket: { file: vi.fn(fileOf) } as unknown as AdminBucket,
    };
  }

  const STAGED = 'staffUploads/u-editor/a1b2c3d4-staged';
  const PHOTO = 'media/barbers/ivan/operation-photo-0123456';

  it('answers an object’s size and type — the size Storage reports as a string read as a number', async () => {
    const { bucket } = photoBucket({
      [STAGED]: { size: '90210', contentType: 'image/jpeg' },
    });
    expect(
      await storedObjectCopyPorts(bucket).statStoredObject(STAGED),
    ).toEqual({
      ok: true,
      value: { sizeBytes: 90210, contentType: 'image/jpeg' },
    });
  });

  it('answers null for no such object, and an object with no type or size as one the guard refuses', async () => {
    const { bucket } = photoBucket({ [PHOTO]: { size: undefined } });
    const ports = storedObjectCopyPorts(bucket);
    expect(await ports.statStoredObject(STAGED)).toEqual({
      ok: true,
      value: null,
    });
    expect(await ports.statStoredObject(PHOTO)).toEqual({
      ok: true,
      value: { sizeBytes: 0, contentType: null },
    });
  });

  it('copies one object onto another path, replacing what was there', async () => {
    const { bucket, objects, copies } = photoBucket({
      [STAGED]: { size: '90210', contentType: 'image/jpeg' },
      [PHOTO]: { size: '5', contentType: 'image/png' },
    });
    expect(
      await storedObjectCopyPorts(bucket).copyStoredObject(STAGED, PHOTO),
    ).toEqual({ ok: true, value: undefined });
    expect(copies).toEqual([`${STAGED}→${PHOTO}`]);
    expect(objects.get(PHOTO)).toEqual({
      size: '90210',
      contentType: 'image/jpeg',
    });
  });

  it('a failed read or copy carries the code and the path, never the SDK’s words', async () => {
    const { bucket } = photoBucket(
      { [STAGED]: { size: '1', contentType: 'image/jpeg' } },
      [STAGED, PHOTO],
    );
    const ports = storedObjectCopyPorts(bucket);
    const read = await ports.statStoredObject(STAGED);
    const copied = await ports.copyStoredObject(STAGED, PHOTO);
    for (const [answer, path] of [
      [read, STAGED],
      [copied, PHOTO],
    ] as const) {
      expect(answer.ok).toBe(false);
      expect(answer).toMatchObject({
        error: { errorCode: RepositoryErrorCode.WriteFailed, path },
      });
      expect(JSON.stringify(answer)).not.toContain(PRIVACY_SENTINELS.email);
    }
  });

  it('a source that is not there fails the copy', async () => {
    const { bucket } = photoBucket({});
    expect(
      (await storedObjectCopyPorts(bucket).copyStoredObject(STAGED, PHOTO)).ok,
    ).toBe(false);
  });
});
