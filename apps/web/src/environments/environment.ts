// Firebase's web config is public, non-secret client config — safe to
// commit; security comes from Firestore/Functions rules and Auth, not from
// hiding this object. Placeholder values until the real Firebase project
// exists; fill in once it's created.
export const environment = {
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    projectId: 'REPLACE_ME',
    storageBucket: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
};
