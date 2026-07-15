// Firebase web config is public, non-secret client config — security comes
// from Firestore/Functions rules and Auth, not from hiding this object.
// Replace these placeholders once the real Firebase project exists.
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
