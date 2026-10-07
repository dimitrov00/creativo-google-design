import { TestBed } from '@angular/core/testing';
import {
  FIREBASE_APP,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import { loadStorageAdapters } from '@creativo/infrastructure/storage';
import { appConfig, firebaseData } from './app.config';

/**
 * The composition root's half of the lazy data layer.
 *
 * lazy-port.spec.ts (firebase-app) proves the mechanism on fakes. This proves
 * the REAL wiring: the app's actual providers, every port bound to the data
 * scope injected, and still nothing loaded — so no binding, initializer or
 * eager provider in `appConfig` pulls the Firestore and Storage chunks into
 * boot, and neither SDK instance is reachable from the root injector.
 *
 * `test` rather than `it`: apps/web lints with eslint-plugin-playwright,
 * whose `no-standalone-expect` only recognises `test()`.
 */
describe('appConfig — the lazily bound data ports', () => {
  let load: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The scope's loader is what fetches both chunks
    // (`loadFirestoreAdapters`, `loadStorageAdapters`): watched, not replaced.
    load = vi.spyOn(firebaseData, 'load');
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        // Last, so they win: the eager Firebase singletons as opaque
        // stand-ins, so nothing here can reach the network even if
        // something asked (and nothing should).
        { provide: FIREBASE_APP, useValue: {} },
        { provide: FIREBASE_AUTH, useValue: {} },
        { provide: FIREBASE_FUNCTIONS, useValue: {} },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    load.mockRestore();
  });

  test('injects every lazily bound port without loading the data layer', async () => {
    const tokens = TestBed.inject(firebaseData.ports);
    const ports = tokens.map((token) => TestBed.inject(token));
    // Anything a port set off on injection has had its turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const port of ports) {
      // Each is the lazy proxy — a frozen plain object — not an adapter a
      // later eager binding put back in its place.
      expect(Object.isFrozen(port)).toBe(true);
      expect(Object.getPrototypeOf(port)).toBe(Object.prototype);
    }
    expect(load).not.toHaveBeenCalled();
  });

  test('keeps the Firestore and Storage instances out of the root injector', async () => {
    expect(TestBed.inject(FIREBASE_FIRESTORE, null)).toBeNull();

    // The Storage token ships in the lazy chunk itself; this spec imports it
    // directly, behind the scope's back, only to name it.
    const { FIREBASE_STORAGE } = await loadStorageAdapters();
    expect(TestBed.inject(FIREBASE_STORAGE, null)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
