import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import {
  FirebaseStorage,
  connectStorageEmulator,
  getStorage,
} from 'firebase/storage';
import {
  FIREBASE_APP,
  FirebaseEmulatorConfig,
} from '@creativo/infrastructure/firebase-app';

/**
 * `libs/infrastructure/firebase-app` only provides the App/Auth/Firestore/
 * Functions tokens every app needs — Storage is heavier and only a handful
 * of features (avatar upload, media resolution) touch it, so this lib owns
 * its own bootstrapping token, composed in separately by whichever app
 * config actually needs it.
 */
export const FIREBASE_STORAGE = new InjectionToken<FirebaseStorage>(
  'FIREBASE_STORAGE',
);

export function provideFirebaseStorage(emulator?: FirebaseEmulatorConfig) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_STORAGE,
      useFactory: () => {
        const storage = getStorage(inject(FIREBASE_APP));
        if (emulator?.storageHost && emulator?.storagePort !== undefined) {
          connectStorageEmulator(
            storage,
            emulator.storageHost,
            emulator.storagePort,
          );
        }
        return storage;
      },
    },
  ]);
}
