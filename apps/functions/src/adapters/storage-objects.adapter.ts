import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { ObjectEraserPorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';
import type { AdminBucket } from '../lib/firebase-admin';

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

function deleteFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.writeFailed(
    path,
    TriggerAttemptSystem.failureCode(error),
  );
}

export const storageObjectPorts = (bucket: AdminBucket): ObjectEraserPorts => ({
  deleteStoredObject: async (path) => {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(deleteFailed(path, error));
    }
  },

  deleteStoredPrefix: async (prefix) => {
    let files;
    try {
      [files] = await bucket.getFiles({ prefix });
    } catch (error) {
      return Result.err(deleteFailed(prefix, error));
    }
    for (const file of files) {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (error) {
        return Result.err(deleteFailed(prefix, error));
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
        : Result.err(deleteFailed(path, error));
    }
  },
});
