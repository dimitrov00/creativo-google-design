import { expect, test } from '@playwright/test';
import { Role } from '@core/components';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import {
  lockBarberLink,
  removeAddedBarber,
  removeUserProfile,
  seedUserProfile,
  seedWorkingBarber,
} from './support/seed-firestore';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/*
 * A barber's own way in (account first, A4–A5 —
 * docs/architecture/decisions/2026-11-16-account-first-team.md): the first
 * time a linked barber opens the schedule, the welcome page; let go, it
 * stays gone on the device, and the setup card stays until the profile is
 * done, leading to their own page; the menu's «Моят профил» row leads there
 * for good, and never shows for the owner with no record of their own.
 */
test.describe('a newly linked barber’s first visit', () => {
  test.describe.configure({ mode: 'default' });

  let added: string | null = null;
  let barberUid: string | null = null;

  test.afterEach(async () => {
    if (added !== null) await removeAddedBarber(added);
    if (barberUid !== null) await removeUserProfile(barberUid);
    added = null;
    barberUid = null;
  });

  test('the welcome first, «По-късно» lets it go; the setup card stays and opens their own page, and so does the menu’s «Моят профил»', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const key = attemptKey(test.info());
    const ownerUid = `e2e-welcome-owner-${key}`;
    barberUid = `e2e-welcome-barber-${key}`;
    await seedUserProfile(ownerUid, {
      firstName: 'Собственик',
      lastName: 'Посреща',
      roles: [Role.Admin],
    });
    await signInAs(page, ownerUid, ['admin']);
    // The owner reaches everyone's profile and has no record of their own:
    // the menu has «Екип» and no «Моят профил». (The menu sits behind the
    // header's monogram, which the account page carries.)
    await page.goto('/account', { waitUntil: 'commit' });
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 30_000 },
    );
    await page.getByTestId('nav-menu-trigger').click();
    await expect(page.getByTestId('menu-admin-team')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('menu-staff-profile')).toHaveCount(0);
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    // The record first, linked to the account below (the link is seeded:
    // the welcome is about the barber's first visit, not the lookup).
    await page.getByTestId('team-barber-account-skip').click();
    await page.getByTestId('team-add-name').fill(`Нов Посрещнат ${key}`);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = decodeURIComponent(
      new URL(page.url()).pathname.split('/').at(-1) ?? '',
    );
    await seedWorkingBarber(added, LocalDate.addDays(shopToday(), -1));
    await seedUserProfile(barberUid, {
      firstName: 'Петър',
      lastName: 'Посрещнат',
      roles: [Role.Client, Role.Barber],
      linkedBarberId: added,
    });
    await lockBarberLink(added, barberUid);
    await removeUserProfile(ownerUid);

    // The barber's first visit: the welcome over the schedule.
    await signInAs(page, barberUid, ['client', 'barber']);
    await page.goto('/staff/schedule', { waitUntil: 'commit' });
    // A page of its own, greeting them by their first name, their face in
    // front of the team's.
    const welcome = page.getByTestId('staff-welcome');
    await expect(page.getByTestId('staff-welcome-headline')).toHaveText(
      'Петър, вече си в екипа',
      { timeout: 60_000 },
    );
    await expect(
      page.getByTestId('staff-welcome-faces').locator('ui-avatar').first(),
    ).toBeVisible();
    // The centre is the person reading, named as their account names them
    // («Петър Посрещнат»), not as the record does («Нов Посрещнат …»): the
    // initials agree with the greeting.
    await expect(
      page
        .getByTestId('staff-welcome-faces')
        .locator('.ui-avatar-orbit__center'),
    ).toHaveText('ПП');
    await page.getByTestId('staff-welcome-later').click();
    await expect(welcome).toHaveCount(0, { timeout: 30_000 });

    // The setup card stays; on the next visit the welcome does not return.
    const card = page.getByTestId('staff-setup-card');
    await expect(card).toContainText('Довърши профила си', {
      timeout: 30_000,
    });
    await page.reload({ waitUntil: 'commit' });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('staff-welcome')).toHaveCount(0);

    // «Продължи»: their own page, where the profile is set — the profile
    // opens for them, the rest is the owner's; back leads to the schedule.
    await card.getByTestId('staff-setup-card-open').click();
    await expect(page).toHaveURL((url) => url.pathname === '/staff/profile', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-name')).toHaveText(
      `Нов Посрещнат ${key}`,
      { timeout: 30_000 },
    );
    await expect(
      page.locator('button[data-testid="member-row-profile"]'),
    ).toBeVisible();
    await expect(
      page.locator('button[data-testid="member-row-period"]'),
    ).toHaveCount(0);
    await page.getByTestId('admin-team-member-back').click();
    await expect(page).toHaveURL((url) => url.pathname === '/staff/schedule', {
      timeout: 30_000,
    });

    // With nothing finished and the welcome let go, the menu is the way
    // back that never leaves: «Моят профил» opens their own page, and back
    // returns to where the menu was opened.
    await page.goto('/account', { waitUntil: 'commit' });
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 30_000 },
    );
    await page.getByTestId('nav-menu-trigger').click();
    const ownProfile = page.getByTestId('menu-staff-profile');
    await expect(ownProfile).toContainText('Моят профил', { timeout: 30_000 });
    await ownProfile.click();
    await expect(page).toHaveURL((url) => url.pathname === '/staff/profile', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-name')).toHaveText(
      `Нов Посрещнат ${key}`,
      { timeout: 30_000 },
    );
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/account', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 30_000 },
    );
  });
});
