import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {
  Functions,
  connectFunctionsEmulator,
  getFunctions,
} from 'firebase/functions';

/**
 * Public, non-secret client config (Firebase web config is safe to commit —
 * security comes from Firestore/Functions rules and Auth, not from hiding
 * this object). Each app supplies its own via `provideFirebaseApp()` in
 * `app.config.ts`, sourced from that app's `src/environments/environment.ts`.
 */
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
export const FIREBASE_FIRESTORE = new InjectionToken<Firestore>(
  'FIREBASE_FIRESTORE',
);
export const FIREBASE_FUNCTIONS = new InjectionToken<Functions>(
  'FIREBASE_FUNCTIONS',
);

/**
 * Only registers the Firebase App instance. Compose with
 * `provideFirebaseAuth()`/`provideFirestoreDb()`/`provideFirebaseFunctions()`
 * below so an app only pulls in the Firebase services it actually uses —
 * e.g. a marketing-only route tree has zero direct Firebase SDK usage and
 * provides none of these.
 */
export function provideFirebaseApp(options: FirebaseOptions) {
  return makeEnvironmentProviders([
    { provide: FIREBASE_APP, useFactory: () => initializeApp(options) },
  ]);
}

/** Emulator host/port config, sourced from each app's `environment.ts` — never hardcoded in a provider. */
export interface FirebaseEmulatorConfig {
  readonly authUrl?: string;
  readonly firestoreHost?: string;
  readonly firestorePort?: number;
  readonly functionsHost?: string;
  readonly functionsPort?: number;
  /** Consumed by `libs/infrastructure/storage`'s own provider — declared here so every emulated service reads one config shape. */
  readonly storageHost?: string;
  readonly storagePort?: number;
}

export function provideFirebaseAuth(emulator?: FirebaseEmulatorConfig) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_AUTH,
      useFactory: () => {
        const auth = getAuth(inject(FIREBASE_APP));
        if (emulator?.authUrl) {
          connectAuthEmulator(auth, emulator.authUrl, {
            disableWarnings: true,
          });
        }
        return auth;
      },
    },
  ]);
}

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

export function provideFirebaseFunctions(emulator?: FirebaseEmulatorConfig) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_FUNCTIONS,
      useFactory: () => {
        const functions = getFunctions(inject(FIREBASE_APP));
        if (emulator?.functionsHost && emulator.functionsPort) {
          connectFunctionsEmulator(
            functions,
            emulator.functionsHost,
            emulator.functionsPort,
          );
        }
        return functions;
      },
    },
  ]);
}
