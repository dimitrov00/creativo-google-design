import { expect, test } from '@playwright/test';
import { mintCustomToken } from './support/mint-custom-token';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

/**
 * Phase 5 exit gate smoke suite (blueprint §8) — run against Firebase
 * emulators via `pnpm run e2e:web`. Covers exactly the three assertions
 * the goal condition names: the app boots, an anonymous visitor hitting
 * `/account` lands on `/auth`, and a signed-in non-staff visitor hitting
 * `/staff` sees the Forbidden screen.
 */
test.describe('app shell', () => {
  test('boots and renders the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Creativo/);
    await expect(page.locator('cr-root')).toBeVisible();
  });

  test('anonymous visitor hitting /account is redirected to /auth', async ({
    page,
  }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/auth(\?|$)/);
  });

  test('non-staff visitor hitting /staff sees the Forbidden screen', async ({
    page,
  }) => {
    const uid = `e2e-nonstaff-${test.info().testId}`;
    const token = await mintCustomToken(uid, {
      stage: 'active',
      roles: ['client'],
    });

    await page.goto('/');
    await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
    await page.evaluate(
      (customToken) => window.__e2eSignIn?.(customToken),
      token,
    );

    // Confirm the session actually settled as `active` before exercising
    // the role gate — /account only requires `activeGuard`, not a role.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account$/);

    await page.goto('/staff');
    await expect(page).toHaveURL(/\/forbidden$/);
    // Default lang is 'bg' (provideI18n()) — match either catalog's string
    // rather than asserting a specific locale.
    await expect(page.locator('h1')).toHaveText(/forbidden|забранено/i);
  });
});
