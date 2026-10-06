// The LAZY half of this lib: the Storage SDK, the instance provider and the
// adapters over it. Nothing may import this module statically outside this
// lib — it is reached only through `loadStorageAdapters()`
// (./storage.lazy.ts), which is what keeps firebase/storage out of the web
// app's initial chunk. tools/verify/bundle/check-initial-bundle.mjs fails a
// build where it leaks.
export * from './storage.provider';
export * from './avatar-uploader.adapter';
export * from './media-reader.adapter';
export * from './appointment-photos.adapter';
export * from './client-photos-reader.adapter';
