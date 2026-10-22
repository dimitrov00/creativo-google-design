import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
// TYPE-ONLY, and it must stay that way: this file is in the initial chunk,
// and a value import of firebase/firestore puts the whole SDK there. The
// instance is created lazily by `provideFirestoreDb()` in
// `@creativo/infrastructure/firestore`'s lazily imported adapter module.
import type { Firestore } from 'firebase/firestore';
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
/**
 * Provided only inside the lazy data scope's injector (see
 * `provideFirestoreDb()` in `@creativo/infrastructure/firestore`), never at
 * the root: only the Firestore bundles reach it, each built by its factory
 * in that injector's context. The scope creates the instance as it loads
 * (it is in the scope's `instances`), so a throw there fails the load
 * rather than a bundle (`./lazy-port.ts`).
 */
export const FIREBASE_FIRESTORE = new InjectionToken<Firestore>(
  'FIREBASE_FIRESTORE',
);
export const FIREBASE_FUNCTIONS = new InjectionToken<Functions>(
  'FIREBASE_FUNCTIONS',
);

/**
 * Only registers the Firebase App instance. Compose with
 * `provideFirebaseAuth()`/`provideFirebaseFunctions()` below — the services
 * the session needs at boot — so an app only pulls in the Firebase services
 * it actually uses. Firestore and Storage are not here: they load with their
 * adapters on the first data-port call (`provideLazyPort`, `./lazy-port.ts`).
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
