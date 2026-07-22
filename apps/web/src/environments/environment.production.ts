// See environment.ts — same placeholder note applies; this file is swapped
// in for production builds via project.json's fileReplacements.
export const environment = {
  production: true,
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    projectId: 'REPLACE_ME',
    storageBucket: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
  emulators: {
    enabled: false,
    authUrl: undefined,
    firestoreHost: undefined,
    firestorePort: undefined,
    functionsHost: undefined,
    functionsPort: undefined,
  },
};
