import { expect, test } from '@playwright/test';
import { Role } from '@core/components';
import { seedUserProfile } from './support/seed-firestore';
import { mintActiveToken, signInAs } from './support/sign-in';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

/**
 * Phase 5 exit gate smoke suite (blueprint §8) — run against Firebase
 * emulators via `pnpm run e2e:web`. Covers the three assertions the goal
 * condition names: the app boots, an anonymous visitor hitting `/account`
 * lands on `/auth`, and a signed-in non-staff visitor hitting `/staff` sees
 * the Forbidden screen — and, since client-card-revision-3 (§3.17, X2),
 * the shell menu's admin entry: «Лоялност», the rhythm rule's page, shown
 * to the admin pair only.
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
    const token = await mintActiveToken(uid, [Role.Client]);

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

  test('the menu offers the admin «Лоялност», which opens the rhythm rule', async ({
    page,
  }) => {
    const uid = `e2e-admin-${test.info().testId}`;
    await seedUserProfile(uid);
    await signInAs(page, uid, [Role.Admin]);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    // The entry sits in a group of its own after the account's rows (X2-3:
    // mine, then what I manage, then the site), behind the monogram.
    await page.getByTestId('nav-menu-trigger').click();
    const entry = page.getByTestId('menu-admin-loyalty');
    await expect(entry).toBeVisible();
    await entry.click();
    // The route is the admin pair's (`rolesGuard('admin', 'sysadmin')`):
    // the page, not /forbidden.
    await expect(page).toHaveURL(/\/admin\/loyalty\/rhythm$/);
  });

  test('a client finds no admin entry in the menu', async ({ page }) => {
    const uid = `e2e-client-menu-${test.info().testId}`;
    await seedUserProfile(uid);
    await signInAs(page, uid, [Role.Client]);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await page.getByTestId('nav-menu-trigger').click();
    // The menu is open (its sign-out is there) and the admin row is not.
    await expect(page.getByTestId('menu-sign-out')).toBeVisible();
    await expect(page.getByTestId('menu-admin-loyalty')).toHaveCount(0);
  });
});
