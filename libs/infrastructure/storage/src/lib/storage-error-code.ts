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
