import type { Page } from '@playwright/test';
import { AuthClaims, type Role } from '@core/components';
import { TenantId } from '@core/primitives';
import { mintCustomToken } from './mint-custom-token';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

/**
 * The seeded deployment's tenant — the claim every token the functions
 * mint carries (`apps/functions/src/main.ts`' default tenant). A token
 * without it reads as an onboarding principal (`Principal.fromClaims`,
 * Phase 4a 4A-2 (b)), so every test session carries it.
 */
const SEED_TENANT: TenantId = TenantId.of('creativo');

/**
 * A custom token for `uid` holding `roles` on the seed tenant — the claims
 * spelled through `AuthClaims.toToken`, the one place the token's shape is
 * written (`stage`/`roles`/`tenantId`), exactly as the functions mint them.
 */
export async function mintActiveToken(
  uid: string,
  roles: readonly [Role, ...Role[]],
): Promise<string> {
  const claims = AuthClaims.active(SEED_TENANT, roles);
  if (!claims.ok) throw new Error('active claims need a role');
  return mintCustomToken(uid, { ...AuthClaims.toToken(claims.value) });
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
 * The role list is non-empty by type: `AuthClaims.fromToken` treats an
 * empty list as an onboarding session, which is never what a spec means.
 */
export async function signInAs(
  page: Page,
  uid: string,
  roles: readonly [Role, ...Role[]],
): Promise<void> {
  const token = await mintActiveToken(uid, roles);
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
