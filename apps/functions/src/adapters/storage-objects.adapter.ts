import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { ObjectEraserPorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';
import type { AdminBucket } from '../lib/firebase-admin';

/**
 * The erasure's Storage deletions over the Admin SDK's default bucket
 * (audit-hardening Phase 3, WS-D — `ObjectEraserPorts`, P3-L-10): one
 * object by its path (a `SHOT` visit photo, deleted BEFORE its document so
 * a resume still knows the path), and every object under a prefix (the
 * account's `avatars/<uid>/`, deleted on every call of a linked person).
 * The Admin SDK bypasses `storage.rules`.
 *
 * Both are idempotent: an object already gone is done
 * (`delete({ ignoreNotFound: true })`). A prefix is LISTED
 * (`getFiles({ prefix })`) and each object deleted — the count is the
 * list's length, since `bucket.deleteFiles` resolves `void`
 * (@google-cloud/storage 7.21, `bucket.d.ts:702`). A failure is
 * `RepositoryError.writeFailed(<path or prefix>, <canonical code>)` — ids
 * only in the path, never the SDK's message.
 */

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
});
