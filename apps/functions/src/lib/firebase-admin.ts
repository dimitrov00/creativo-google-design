import { App, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let app: App | undefined;

function adminApp(): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp();
  }
  return app;
}

export function adminFirestore(): Firestore {
  return getFirestore(adminApp());
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

/**
 * A Cloud Storage bucket as the Admin SDK hands it out — named through the
 * SDK's own `Storage.bucket` (a subpath of the existing `firebase-admin`;
 * its `@google-cloud/storage` is no dependency of ours, P3-RU-28).
 */
export type AdminBucket = ReturnType<Storage['bucket']>;

/**
 * The project's DEFAULT bucket (audit-hardening Phase 3, WS-D — the
 * erasure's object deletions): the one `FIREBASE_CONFIG` names, the
 * functions emulator's `${projectId}.appspot.com` — the bucket the seed and
 * the web write the avatars and the visit photos to.
 */
export function adminBucket(): AdminBucket {
  return getStorage(adminApp()).bucket();
}
