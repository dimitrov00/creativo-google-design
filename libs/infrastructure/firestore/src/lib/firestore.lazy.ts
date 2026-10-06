/**
 * The Firestore SDK, its instance provider (`provideFirestoreDb`) and every
 * Firestore adapter, as ONE dynamic import — its own chunk, fetched on the
 * first call of a port bound to it with `provideLazyPort`.
 */
export const loadFirestoreAdapters = () => import('./firestore.adapters');

/** The module `loadFirestoreAdapters()` resolves to. */
export type FirestoreAdapters = Awaited<
  ReturnType<typeof loadFirestoreAdapters>
>;
