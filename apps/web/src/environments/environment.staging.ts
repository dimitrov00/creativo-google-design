// A named import, so the bundle carries only this environment's map.
import { staging as featureFlags } from '@creativo/config/feature-flags';

// The staging project's web config (ADR 2026-11-18, E3): swapped in for
// `environment.ts` by `web:build:staging` (project.json's fileReplacements),
// the same shape as environment.production.ts. Public client config — commit
// the staging project's values here (Firebase console → Project settings →
// Your apps → Web); the preflight's P4 refuses a build that still carries
// REPLACE_ME or names another project.
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
  // App Check (security hardening S-RU-18): the staging project's OWN
  // reCAPTCHA Enterprise site key — public client config like `firebase`
  // above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },
  featureFlags,
};
