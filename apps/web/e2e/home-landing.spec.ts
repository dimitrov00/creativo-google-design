import { expect, test, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { DEV_CHAIR } from './support/appointment-seed-document';
import { seedUserProfile } from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { emulateInstalledApp } from './support/standalone';

/*
 * WHERE THE INSTALLED APP OPENS (owner rulings 2026-11-25, Q3–Q4 of the
 * role-aware homes brief). The manifest's `start_url` is `./`, so every
 * launch passes `/`, whose gate sends a signed-in person to the home of
 * their main job: whoever works the book to the schedule — on their own
 * chair when their account links one — a content manager to the programs,
 * a client to the account. Zero taps from launch to the day.
 *
 * The same landing answers every post-sign-in navigation with no link to
 * follow, `/admin`, and `/forbidden`'s way out; the route table's spec
 * (`app.routes.spec.ts`) proves those, and that a sign-in's remembered link
 * the person can no longer open lands them home.
 */

/** Signs in as an installed app, then launches it: `/`, cold. */
async function launchAs(
  page: Page,
  uid: string,
  roles: readonly [Role, ...Role[]],
  linkedBarberId: string | null = null,
): Promise<void> {
  await seedUserProfile(uid, { roles, linkedBarberId });
  await emulateInstalledApp(page);
  await signInAs(page, uid, roles);
  await page.goto('/');
}

test.describe('the installed app opens on each person’s home', () => {
  test('an owner who cuts hair: the schedule, on their own chair', async ({
    page,
  }) => {
    await launchAs(
      page,
      `e2e-home-owner-${test.info().testId}`,
      [Role.Client, Role.Barber, Role.Admin],
      DEV_CHAIR.barberId,
    );
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/staff/schedule' &&
        url.searchParams.get('barber') === DEV_CHAIR.barberId,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
  });

  test('an owner with no chair, and the front desk: the schedule, every chair', async ({
    page,
  }) => {
    await launchAs(page, `e2e-home-admin-${test.info().testId}`, [Role.Admin]);
    await expect(page).toHaveURL(/\/staff\/schedule$/, { timeout: 30_000 });
  });

  test('a receptionist: the schedule, every chair', async ({ page }) => {
    await launchAs(page, `e2e-home-desk-${test.info().testId}`, [
      Role.Receptionist,
    ]);
    await expect(page).toHaveURL(/\/staff\/schedule$/, { timeout: 30_000 });
  });

  test('a content manager: the programs, never a schedule it cannot read', async ({
    page,
  }) => {
    await launchAs(page, `e2e-home-content-${test.info().testId}`, [
      Role.ContentManager,
    ]);
    await expect(page).toHaveURL(/\/admin\/programs$/, { timeout: 30_000 });
  });

  test('a client: their account', async ({ page }) => {
    await launchAs(page, `e2e-home-client-${test.info().testId}`, [
      Role.Client,
    ]);
    await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  });

  test('a browser tab keeps the landing page, signed in or not', async ({
    page,
  }) => {
    const uid = `e2e-home-tab-${test.info().testId}`;
    await seedUserProfile(uid, { roles: [Role.Barber, Role.Admin] });
    await signInAs(page, uid, [Role.Barber, Role.Admin]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
  });
});
