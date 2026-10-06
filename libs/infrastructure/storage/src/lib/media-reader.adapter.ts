import { Injectable, inject } from '@angular/core';
import { getDownloadURL, ref } from 'firebase/storage';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { MediaRef } from '@creativo/domain/catalog';
import {
  MediaReadError,
  MediaReader,
  MediaUnavailableError,
  MediaUnavailableReason,
  MediaVariant,
} from '@creativo/application/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_STORAGE } from './storage.provider';
import { storageErrorCode } from './storage-error-code';

/**
 * The Storage answers that asking again cannot change. Every other code —
 * `retry-limit-exceeded` (the SDK's own network retries ran out),
 * `quota-exceeded`, `unknown`, `server-file-wrong-size`… — and anything
 * that is not a `StorageError` at all stays transient.
 *
 * `unauthenticated` is deliberately NOT here: it can turn into a read once
 * the visitor signs in, and the retry cap bounds its cost anyway.
 */
const PERMANENT: ReadonlyMap<string, MediaUnavailableReason> = new Map<
  string,
  MediaUnavailableReason
>([
  ['storage/object-not-found', 'not_found'],
  ['storage/unauthorized', 'forbidden'],
]);

/**
 * Resolves a `MediaRef` to a single servable variant at its own native
 * width. Deliberate Phase-4 simplification, not a stub: true multi-
 * resolution `srcset` variants need an image-resizing pipeline/extension
 * that isn't provisioned yet — when one lands, this adapter grows the
 * extra width lookups without any port/domain change.
 */
@Injectable()
export class StorageMediaReader implements MediaReader {
  private readonly storage = inject(FIREBASE_STORAGE);

  async resolve(
    mediaRef: MediaRef,
  ): Promise<Result<readonly MediaVariant[], MediaReadError>> {
    try {
      const url = await getDownloadURL(ref(this.storage, mediaRef.path));
      return ok([{ width: mediaRef.width, url }]);
    } catch (error) {
      return fail(toMediaReadError(mediaRef.path, error));
    }
  }
}

/** A `getDownloadURL` failure → permanent or transient, the cause kept. */
function toMediaReadError(path: string, error: unknown): MediaReadError {
  const code = storageErrorCode(error);
  const permanent = code === undefined ? undefined : PERMANENT.get(code);
  return permanent
    ? new MediaUnavailableError(permanent, path, error)
    : new RepositoryError(`Failed to resolve media at "${path}"`, error);
}
