// A named import, so the bundle carries only this environment's map.
import { staging as featureFlags } from '@creativo/config/feature-flags';
import type { WebEnvironment } from './web-environment';

// The staging project's web config (ADR 2026-11-18, E3): swapped in for
// `environment.ts` by `web:build:staging` (project.json's fileReplacements),
// the same shape as environment.production.ts. Public client config, from
// Firebase console → Project settings → Your apps → Web
// (`creativo-web-staging`, registered 2026-11-18); the preflight's P4 refuses
// a build that carries REPLACE_ME or names another project. The console's
// `measurementId` is left out: the web loads no Analytics.
//
// The apiKey is the project's browser key: it names the project, it grants
// nothing (rules, the callables' checks and App Check decide). It ships in
// every visitor's bundle, so the line carries gitleaks' inline allow rather
// than a path-wide allowlist that would also hide a real secret here.
export const environment: WebEnvironment = {
  firebase: {
    apiKey: 'AIzaSyDPYWqgjeCdPh5lCLNuJ8G904LsvPr_kfs', // gitleaks:allow
    authDomain: 'creativo-v2-staging.firebaseapp.com',
    projectId: 'creativo-v2-staging',
    storageBucket: 'creativo-v2-staging.firebasestorage.app',
    messagingSenderId: '1077508832992',
    appId: '1:1077508832992:web:d55abe8614c9c1e63f5a85',
  },
  // A deployed build talks to its project, never to emulators.
  emulators: null,
  // App Check (security hardening S-RU-18): the staging project's OWN
  // reCAPTCHA Enterprise site key — public client config like `firebase`
  // above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },
  featureFlags,
};
