import { MediaError } from '@core/errors';

/** Storage's answer for an object that is not there. */
export const OBJECT_NOT_FOUND = 'storage/object-not-found';
/** Storage's answer for a read or write the rules refuse. */
const UNAUTHORIZED = 'storage/unauthorized';

/**
 * The `storage/…` code of a Firebase Storage failure (`StorageError.code`,
 * e.g. `storage/object-not-found`), or `undefined` for anything else.
 *
 * Read structurally rather than by `instanceof StorageError`: the SDK's
 * class is not a stable identity across bundles, and a spec that mocks
 * `firebase/storage` throws plain objects carrying the same `code`.
 */
export function storageErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A Storage failure at `path` as the media ports' error — the ONE mapping
 * of this lib (avatars, catalogue media, visit-photo bytes): Storage's two
 * permanent answers (`object-not-found`, `unauthorized`) are permanent
 * here too; everything else — `retry-limit-exceeded` (the SDK's own network
 * retries ran out), `quota-exceeded`, `unknown`, and anything that is not a
 * `StorageError` at all — is worth a bounded retry. `unauthenticated` is
 * deliberately transient: it can turn into a read once the visitor signs
 * in, and the retry cap bounds its cost anyway.
 */
export function mediaErrorOf(path: string, cause: unknown): MediaError {
  switch (storageErrorCode(cause)) {
    case OBJECT_NOT_FOUND:
      return MediaError.notFound(path);
    case UNAUTHORIZED:
      return MediaError.forbidden(path);
    default:
      return MediaError.transient(path);
  }
}
