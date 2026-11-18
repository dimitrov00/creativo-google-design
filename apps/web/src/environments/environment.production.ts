// A named import, so the bundle carries only this environment's map.
import { production as featureFlags } from '@creativo/config/feature-flags';
import type { WebEnvironment } from './web-environment';

// The production project's web config: swapped in for `environment.ts` by
// `web:build:production` (project.json's fileReplacements). Public client
// config — commit the production project's values here (Firebase console →
// Project settings → Your apps → Web); the preflight's P4 refuses a build
// that still carries REPLACE_ME or names another project.
export const environment: WebEnvironment = {
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    projectId: 'REPLACE_ME',
    storageBucket: 'REPLACE_ME',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
  // A deployed build talks to its project, never to emulators.
  emulators: null,
  // App Check (security hardening S-RU-18): the reCAPTCHA Enterprise SITE key — public client
  // config like `firebase` above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },
  featureFlags,
};
