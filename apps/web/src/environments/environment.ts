// A named import, so the bundle carries only this environment's map.
import { development as featureFlags } from '@creativo/config/feature-flags';
import type { WebEnvironment } from './web-environment';

// The local build's environment (`nx serve`, the e2e suites, the CSP smoke):
// the demo project against the emulators. Firebase's web config is public,
// non-secret client config — the REPLACE_ME values here never reach a real
// project, because every service below is pointed at an emulator. The
// deployed builds swap in environment.staging.ts / environment.production.ts.

// Whoever served the app is also running the emulators: `localhost` on this
// machine, the Mac's LAN IP when a phone loads it over Wi-Fi. A hardcoded
// 127.0.0.1 would point that phone at *itself*, so follow the serving origin
// instead — firebase.json binds every emulator to 0.0.0.0 to answer on both.
// (Falls back for non-browser callers; nothing here has a `location`.)
const emulatorHost =
  typeof globalThis.location === 'undefined'
    ? '127.0.0.1'
    : globalThis.location.hostname;

export const environment: WebEnvironment = {
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    projectId: 'demo-creativo-test',
    // A real-looking bucket name is required for `getStorage()` to build
    // object URLs; under the demo project everything stays in the emulator.
    storageBucket: 'demo-creativo-test.appspot.com',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
  // Matches firebase.json's emulator ports — dev/serve and e2e-against-
  // emulators both use this default configuration unchanged.
  emulators: {
    authUrl: `http://${emulatorHost}:9099`,
    firestoreHost: emulatorHost,
    firestorePort: 8080,
    functionsHost: emulatorHost,
    functionsPort: 5001,
    storageHost: emulatorHost,
    storagePort: 9199,
  },
  // App Check (security hardening S-RU-18): the reCAPTCHA Enterprise SITE key — public client
  // config like `firebase` above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },
  // Build-time flags (R41): the manifest's `development` map, parsed and
  // validated by `provideFlags` at bootstrap.
  featureFlags,
};
