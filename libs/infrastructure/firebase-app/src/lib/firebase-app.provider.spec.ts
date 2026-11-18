import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
} from '@angular/core';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';

const { authMocks, AUTH } = vi.hoisted(() => ({
  AUTH: { name: 'auth' },
  authMocks: {
    initializeAuth: vi.fn(),
    getAuth: vi.fn(),
    connectAuthEmulator: vi.fn(),
  },
}));

vi.mock('firebase/auth', async () => ({
  ...(await vi.importActual<typeof import('firebase/auth')>('firebase/auth')),
  initializeAuth: authMocks.initializeAuth,
  getAuth: authMocks.getAuth,
  connectAuthEmulator: authMocks.connectAuthEmulator,
}));

const {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
} = await import('firebase/auth');
const { FIREBASE_APP, FIREBASE_AUTH, provideFirebaseAuth } =
  await import('./firebase-app.provider');

const APP = { name: '[DEFAULT]' } as unknown as FirebaseApp;

/** The dev environment's emulator addresses (`environment.ts`, `firebase.json`'s ports). */
const EMULATORS = {
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  functionsHost: '127.0.0.1',
  functionsPort: 5001,
  storageHost: '127.0.0.1',
  storagePort: 9199,
} as const;

/** The auth instance a root built with `provideFirebaseAuth(emulator)` hands out. */
function authFrom(emulator: Parameters<typeof provideFirebaseAuth>[0]): Auth {
  const injector = createEnvironmentInjector(
    [{ provide: FIREBASE_APP, useValue: APP }, provideFirebaseAuth(emulator)],
    Injector.NULL as EnvironmentInjector,
  );
  return injector.get(FIREBASE_AUTH);
}

/*
 * OR-32: Firebase Auth is built with `initializeAuth` and NO popup/redirect
 * resolver — `getAuth` would wire `browserPopupRedirectResolver`, which loads
 * `apis.google.com` and a hidden auth iframe on phones and Safari, neither of
 * which the strict CSP admits (OR-29) nor any sign-in here needs.
 */
describe('provideFirebaseAuth — initializeAuth, no popup/redirect resolver', () => {
  beforeEach(() => {
    authMocks.initializeAuth.mockReset().mockReturnValue(AUTH);
    authMocks.getAuth.mockReset();
    authMocks.connectAuthEmulator.mockReset();
  });

  it('initialises the app’s auth with getAuth’s persistence order and nothing else', () => {
    expect(authFrom(null)).toBe(AUTH);

    expect(authMocks.initializeAuth).toHaveBeenCalledTimes(1);
    const [app, deps] = authMocks.initializeAuth.mock.calls[0] ?? [];
    expect(app).toBe(APP);
    expect(deps).toEqual({
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
    });
    // The point of the ruling: no resolver, so no third-party script or frame.
    expect(Object.keys(deps as object)).toEqual(['persistence']);
    expect(deps).not.toHaveProperty('popupRedirectResolver');
    expect(authMocks.getAuth).not.toHaveBeenCalled();
  });

  it('connects the Auth emulator when the environment names one', () => {
    const auth = authFrom(EMULATORS);

    expect(authMocks.connectAuthEmulator).toHaveBeenCalledWith(
      auth,
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
  });

  it('connects nothing in a deployed build (no emulators)', () => {
    authFrom(null);

    expect(authMocks.connectAuthEmulator).not.toHaveBeenCalled();
  });
});
