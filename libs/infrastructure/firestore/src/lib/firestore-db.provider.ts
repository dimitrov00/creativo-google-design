import { inject, makeEnvironmentProviders } from '@angular/core';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {
  FIREBASE_APP,
  FIREBASE_FIRESTORE,
  FirebaseEmulatorConfig,
} from '@creativo/infrastructure/firebase-app';

/**
 * The app's one Firestore instance. Reached only through
 * `loadFirestoreAdapters()`: the web app passes it to its lazy data scope,
 * whose injector creates the instance once, on the first data-port call —
 * never at boot, and never in the initial chunk.
 */
export function provideFirestoreDb(emulator?: FirebaseEmulatorConfig) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_FIRESTORE,
      useFactory: () => {
        // Persistent IndexedDB cache, NOT the default memory cache. The
        // default is memory with EAGER GC: every listener teardown discards
        // its docs and resume tokens, so each remount of a page re-bills its
        // whole result set. Persistent cache serves unchanged docs locally
        // and resumes listeners from tokens — the single biggest read-cost
        // lever in the app (~150-200k reads/month at current scale). The
        // multi-tab manager keeps two open tabs from fighting over the
        // IndexedDB lease; where IndexedDB is unavailable (private mode) the
        // SDK falls back to memory on its own.
        const firestore = initializeFirestore(inject(FIREBASE_APP), {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        });
        if (emulator?.firestoreHost && emulator.firestorePort) {
          connectFirestoreEmulator(
            firestore,
            emulator.firestoreHost,
            emulator.firestorePort,
          );
        }
        return firestore;
      },
    },
  ]);
}
