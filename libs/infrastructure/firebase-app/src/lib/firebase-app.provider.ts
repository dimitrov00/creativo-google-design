import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
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

/**
 * Where the local emulators answer — every emulated service's address in one
 * struct, sourced from the dev `environment.ts`, never hardcoded in a
 * provider. A deployed build has none: its environment says `null`, and each
 * provider below connects to an emulator only when handed this struct whole.
 */
export type FirebaseEmulatorConfig = {
  readonly authUrl: string;
  readonly firestoreHost: string;
  readonly firestorePort: number;
  readonly functionsHost: string;
  readonly functionsPort: number;
  /** Consumed by `libs/infrastructure/storage`'s own provider — declared here so every emulated service reads one config shape. */
  readonly storageHost: string;
  readonly storagePort: number;
};

/**
 * The session's persistence, in the order `getAuth` picks it — IndexedDB
 * first, then `localStorage`, then `sessionStorage` (a browser that refuses
 * one falls through to the next).
 */
const FIREBASE_AUTH_PERSISTENCE = [
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
] as const;

/**
 * Firebase Auth WITHOUT a popup/redirect resolver (OR-32): `initializeAuth`
 * with `getAuth`'s own persistence and nothing else. `getAuth` also wires
 * `browserPopupRedirectResolver`, which on phones and Safari loads
 * `apis.google.com` and a hidden `__/auth/iframe` on every page load — for
 * sign-in flows this app never runs (every session starts from a custom
 * token: the OTP callable's, or the e2e hook's). Without it no third-party
 * script or frame is fetched, the strict CSP keeps `frame-src 'none'`
 * (OR-29), and the auth code in the initial chunk is ~11 kB smaller
 * (~3.4 kB gzipped, measured on firebase 12.16). A popup or redirect
 * sign-in added later passes its resolver to that call, never back here.
 */
export function provideFirebaseAuth(emulator: FirebaseEmulatorConfig | null) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_AUTH,
      useFactory: () => {
        const auth = initializeAuth(inject(FIREBASE_APP), {
          persistence: [...FIREBASE_AUTH_PERSISTENCE],
        });
        if (emulator !== null) {
          connectAuthEmulator(auth, emulator.authUrl, {
            disableWarnings: true,
          });
        }
        return auth;
      },
    },
  ]);
}

/**
 * The region the callables run in — the functions' `FUNCTIONS_REGION`
 * (`apps/functions/src/lib/region.ts`, ADR 2026-11-18, europe-west8); the
 * SDK otherwise dials its own default region, where nothing is deployed.
 * `tools/verify/csp/functions-region.spec.mjs` holds the copies equal.
 */
export const FUNCTIONS_REGION = 'europe-west8';

export function provideFirebaseFunctions(
  emulator: FirebaseEmulatorConfig | null,
) {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_FUNCTIONS,
      useFactory: () => {
        const functions = getFunctions(inject(FIREBASE_APP), FUNCTIONS_REGION);
        if (emulator !== null) {
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
