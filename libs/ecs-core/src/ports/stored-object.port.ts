import type { StoredObjectFacts } from '@core/components';
import type { Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';

/**
 * The server's Cloud Storage reads and copies (the Admin SDK's default
 * bucket, which bypasses `storage.rules`) — what a callable needs to take a
 * staged upload into the shop's media
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`).
 * Deleting an object is `StoredObjectDeletePorts` (`privacy.port.ts`), the
 * erasure's own.
 */

/** One object's size and type; `null` when there is no such object. */
export type StatStoredObject = (
  path: string,
) => Promise<Result<StoredObjectFacts | null, RepositoryError>>;

/**
 * Copy one object onto another path, its bytes and its type — replacing
 * what was there. A source that is not there is a failure: the caller
 * stats it first.
 */
export type CopyStoredObject = (
  fromPath: string,
  toPath: string,
) => Promise<Result<void, RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** One object read and copied — `storedObjectCopyPorts` (functions). */
export type StoredObjectCopyPorts = {
  readonly statStoredObject: StatStoredObject;
  readonly copyStoredObject: CopyStoredObject;
};
