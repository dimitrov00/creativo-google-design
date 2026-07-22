// Firebase's web config is public, non-secret client config — safe to
// commit; security comes from Firestore/Functions rules and Auth, not from
// hiding this object. Placeholder values until the real Firebase project
// exists; fill in once it's created.
export const environment = {
  production: false,
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    projectId: 'demo-creativo-test',
    storageBucket: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
  // Matches firebase.json's emulator ports — dev/serve and e2e-against-
  // emulators both use this default configuration unchanged.
  emulators: {
    enabled: true,
    authUrl: 'http://127.0.0.1:9099',
    firestoreHost: '127.0.0.1',
    firestorePort: 8080,
    functionsHost: '127.0.0.1',
    functionsPort: 5001,
  },
};
