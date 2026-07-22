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
  getFirestore,
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
        const firestore = getFirestore(inject(FIREBASE_APP));
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
