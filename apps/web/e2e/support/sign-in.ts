import type { Page } from '@playwright/test';
import type { UserRole } from '@creativo/domain/accounts';
import { mintCustomToken } from './mint-custom-token';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

/**
 * Signs the page in as `uid` holding `roles`, without the OTP screens: a
 * custom token minted against the Auth emulator, handed to the dev build's
 * `window.__e2eSignIn` hook (`E2eSignInHookService`).
 *
 * The roles travel as token claims only, which is what the route guards,
 * `firestore.rules` and today's callables read. Seed `users/{uid}` as well
 * when a flow reads the stored profile, and once F3 lands the stored roles
 * too, which then win over the token (design §12.6.3).
 *
 * The role list is non-empty by type: `parseAuthClaims` treats an empty list
 * as an onboarding session, which is never what a spec means.
 */
export async function signInAs(
  page: Page,
  uid: string,
  roles: readonly [UserRole, ...UserRole[]],
): Promise<void> {
  const token = await mintCustomToken(uid, {
    stage: 'active',
    roles: [...roles],
  });
  // The hook exists only once the app has booted, so a fresh page loads it
  // first; a page already inside the app signs in where it stands.
  const booted = await page.evaluate(
    () => typeof window.__e2eSignIn === 'function',
  );
  if (!booted) await page.goto('/');
  await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
  await page.evaluate(
    (customToken) => window.__e2eSignIn?.(customToken),
    token,
  );
}
