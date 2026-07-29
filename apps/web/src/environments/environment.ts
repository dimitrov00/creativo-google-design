// Firebase's web config is public, non-secret client config — safe to
// commit; security comes from Firestore/Functions rules and Auth, not from
// hiding this object. Placeholder values until the real Firebase project
// exists; fill in once it's created.

// Whoever served the app is also running the emulators: `localhost` on this
// machine, the Mac's LAN IP when a phone loads it over Wi-Fi. A hardcoded
// 127.0.0.1 would point that phone at *itself*, so follow the serving origin
// instead — firebase.json binds every emulator to 0.0.0.0 to answer on both.
// (Falls back for non-browser callers; nothing here has a `location`.)
const emulatorHost =
  typeof globalThis.location === 'undefined'
    ? '127.0.0.1'
    : globalThis.location.hostname;

export const environment = {
  production: false,
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
    enabled: true,
    authUrl: `http://${emulatorHost}:9099`,
    firestoreHost: emulatorHost,
    firestorePort: 8080,
    functionsHost: emulatorHost,
    functionsPort: 5001,
    storageHost: emulatorHost,
    storagePort: 9199,
  },
};
