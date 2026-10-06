/**
 * The Storage SDK, its instance provider (`provideFirebaseStorage`) and the
 * Storage adapters, as ONE dynamic import — its own chunk, fetched on the
 * first call of a port bound to it with `provideLazyPort`.
 */
export const loadStorageAdapters = () => import('./storage.adapters');

/** The module `loadStorageAdapters()` resolves to. */
export type StorageAdapters = Awaited<ReturnType<typeof loadStorageAdapters>>;
