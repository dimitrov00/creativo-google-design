// A named import, so the bundle carries only this environment's map.
import { production as featureFlags } from '@creativo/config/feature-flags';

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
  // App Check (security hardening S-RU-18): the reCAPTCHA Enterprise SITE key — public client
  // config like `firebase` above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },
  featureFlags,
};
