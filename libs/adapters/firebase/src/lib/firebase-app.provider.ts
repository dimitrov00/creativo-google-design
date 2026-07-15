import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { Functions, getFunctions } from 'firebase/functions';

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
 * e.g. apps/marketing has zero direct Firebase SDK usage and provides none
 * of these.
 */
export function provideFirebaseApp(options: FirebaseOptions) {
  return makeEnvironmentProviders([
    { provide: FIREBASE_APP, useFactory: () => initializeApp(options) },
  ]);
}

export function provideFirebaseAuth() {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_AUTH,
      useFactory: () => getAuth(inject(FIREBASE_APP)),
    },
  ]);
}

export function provideFirestoreDb() {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_FIRESTORE,
      useFactory: () => getFirestore(inject(FIREBASE_APP)),
    },
  ]);
}

export function provideFirebaseFunctions() {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_FUNCTIONS,
      useFactory: () => getFunctions(inject(FIREBASE_APP)),
    },
  ]);
}
