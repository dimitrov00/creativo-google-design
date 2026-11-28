import { Result, UtcEpochMs } from '@core/primitives';
import type {
  ObjectEraserPorts,
  StoredObjectCopyPorts,
  StoredObjectListPorts,
} from '@core/ports';
import type { AdminBucket } from '../lib/firebase-admin';
import { writeFailed } from './store-answer';

/**
 * The erasure's Storage writes over the Admin SDK's default bucket
 * (audit-hardening Phase 3, WS-D — `ObjectEraserPorts`, P3-L-10): one
 * object by its path (a `SHOT` visit photo's OWN object, deleted BEFORE its
 * document so a resume still knows the path — the system hands over no
 * other, P3-DEP-30), every object under a prefix (the account's
 * `avatars/<uid>/`, deleted on every call of a linked person), and one KEPT
 * object's `clientLabel` custom metadata removed (a `LIBRARY` photo's
 * picture, P3-DEP-31 — `setMetadata({ metadata: { clientLabel: null } })`,
 * the key deleted, every other key kept). The Admin SDK bypasses
 * `storage.rules`.
 *
 * All three are idempotent: an object already gone is done
 * (`delete({ ignoreNotFound: true })`; a label clear on no object — HTTP
 * 404 — or on an object without the key writes nothing). A prefix is LISTED
 * (`getFiles({ prefix })`) and each object deleted — the count is the
 * list's length, since `bucket.deleteFiles` resolves `void`
 * (@google-cloud/storage 7.21, `bucket.d.ts:702`). A failure is
 * `RepositoryError.writeFailed(<path or prefix>, <canonical code>)` — ids
 * only in the path, never the SDK's message.
 */

/** Whether Storage answered "no such object" (its JSON API's HTTP 404). */
function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 404
  );
}

/** A custom-metadata value as whole pixels; `null` for anything else. */
function pixelsOf(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const pixels = Number(value);
  return Number.isInteger(pixels) && pixels > 0 ? pixels : null;
}

/**
 * The photo call's Storage reads and copies over the same bucket
 * (`StoredObjectCopyPorts`, `setBarberPhoto`): one object's size and type
 * (`null` when there is none — HTTP 404), and one object copied onto
 * another path, bytes, type and custom metadata, replacing what was there.
 * The size Storage reports is a decimal string or a number; anything else
 * reads as an empty object, which the photo's own guard refuses. A
 * picture's pixel size is what its uploader wrote beside it.
 */
export const storedObjectCopyPorts = (
  bucket: AdminBucket,
): StoredObjectCopyPorts => ({
  statStoredObject: async (path) => {
    try {
      const [metadata] = await bucket.file(path).getMetadata();
      const size = Number(metadata.size);
      return Result.ok({
        sizeBytes: Number.isFinite(size) ? size : 0,
        contentType:
          typeof metadata.contentType === 'string'
            ? metadata.contentType
            : null,
        // What the uploader measured (`avatarPorts`): custom metadata is
        // strings; anything that is no whole number reads as not measured.
        pixelWidth: pixelsOf(metadata.metadata?.['mediaWidth']),
        pixelHeight: pixelsOf(metadata.metadata?.['mediaHeight']),
      });
    } catch (error) {
      return isNotFound(error)
        ? Result.ok(null)
        : Result.err(writeFailed(path, error));
    }
  },

  copyStoredObject: async (fromPath, toPath) => {
    try {
      await bucket.file(fromPath).copy(bucket.file(toPath));
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(writeFailed(toPath, error));
    }
  },
});

/** An object's creation time as an instant; `null` when Storage did not say, or said nothing readable. */
function createdOf(value: unknown): UtcEpochMs | null {
  if (typeof value !== 'string') return null;
  const instant = UtcEpochMs.of(Date.parse(value));
  return instant.ok ? instant.value : null;
}

/**
 * A folder's listing over the same bucket (`StoredObjectListPorts`, the
 * description pictures' count and sweep): every object under the prefix,
 * its path and when it was written (`timeCreated`).
 */
export const storedObjectListPorts = (
  bucket: AdminBucket,
): StoredObjectListPorts => ({
  listStoredObjects: async (prefix) => {
    try {
      const [files] = await bucket.getFiles({ prefix });
      return Result.ok(
        files.map((file) => ({
          path: file.name,
          createdUtcMs: createdOf(file.metadata.timeCreated),
        })),
      );
    } catch (error) {
      return Result.err(writeFailed(prefix, error));
    }
  },
});

export const storageObjectPorts = (bucket: AdminBucket): ObjectEraserPorts => ({
  deleteStoredObject: async (path) => {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(writeFailed(path, error));
    }
  },

  deleteStoredPrefix: async (prefix) => {
    let files;
    try {
      [files] = await bucket.getFiles({ prefix });
    } catch (error) {
      return Result.err(writeFailed(prefix, error));
    }
    for (const file of files) {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (error) {
        return Result.err(writeFailed(prefix, error));
      }
    }
    return Result.ok(files.length);
  },

  clearStoredLabel: async (path) => {
    try {
      const file = bucket.file(path);
      const [metadata] = await file.getMetadata();
      // The custom-metadata key a visit photo's object names its client by
      // (`uploadPhotoBytes`).
      const label = metadata.metadata?.['clientLabel'];
      if (label === undefined || label === null || label === '') {
        return Result.ok(undefined);
      }
      await file.setMetadata({ metadata: { clientLabel: null } });
      return Result.ok(undefined);
    } catch (error) {
      return isNotFound(error)
        ? Result.ok(undefined)
        : Result.err(writeFailed(path, error));
    }
  },
});
