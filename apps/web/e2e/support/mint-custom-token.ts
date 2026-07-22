import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'demo-creativo-test';

// Must be set before the Admin SDK's Auth client is first constructed —
// it then skips real service-account signing, matching how the Auth
// emulator itself accepts unsigned tokens (same port as firebase.json's
// `emulators.auth` and apps/web's `environment.ts`).
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??= '127.0.0.1:9099';

/**
 * Mints a Firebase custom token for a fake test uid, carrying the raw
 * `AuthClaims` shape `parseAuthClaims` expects (`stage`/`roles`) as
 * developer claims — Firebase Auth copies custom-token claims onto the
 * resulting ID token, so `signInWithCustomToken` (via `window.__e2eSignIn`,
 * `E2eTestHooksService`) puts the app into exactly the `Principal` this
 * suite needs, no real OTP round-trip required.
 */
export async function mintCustomToken(
  uid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const app =
    getApps().find((candidate) => candidate.name === '[DEFAULT]') ??
    initializeApp({ projectId: PROJECT_ID });
  return getAuth(app).createCustomToken(uid, claims);
}
