// EAGER exports only — nothing here may import firebase/storage as a value.
// The Storage SDK, `provideFirebaseStorage` and the Storage adapters are one
// lazy chunk behind `loadStorageAdapters()` (./lib/storage.lazy.ts); bind
// their ports with `provideLazyPort` (@creativo/infrastructure/firebase-app).
export * from './lib/storage.lazy';
export * from './lib/downscale-image';
