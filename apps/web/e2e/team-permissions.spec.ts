import { type Page, expect, test } from '@playwright/test';
import { Role } from '@core/components';
import { Collections, STAFF_PERMISSIONS_DOC } from '@core/entities';
import { attemptKey } from './support/attempt-key';
import {
  readStoredBody,
  resetStaffPermissions,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/*
 * «Екип» and «Права» (staff permissions, stage T) against the emulators.
 *
 * The cases share ONE document — `settings/staffPermissions` is the whole
 * shop's — so they run one after another and each puts the standard back
 * when it is done: every other spec's staff sessions read the same cells.
 */
test.describe('«Екип» and «Права» — staff permissions', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async () => {
    await resetStaffPermissions();
  });

  /** The ＋ menu's row for a chair's weekly hours. */
  const hoursRow = (page: Page) => page.getByTestId('staff-add-hours');

  test('an owner takes the weekly hours away from the front desk: an open front-desk session loses «Работно време» without signing in again, and gets it back', async ({
    page: desk,
    browser,
  }) => {
    test.setTimeout(180_000);
    const key = attemptKey(test.info());
    const ownerUid = `e2e-perm-owner-${key}`;
    const deskUid = `e2e-perm-desk-${key}`;
    // Both calls judge the STORED account: the owner's save and the front
    // desk's roster calls alike.
    await seedUserProfile(ownerUid, {
      firstName: 'Собственик',
      lastName: 'Права',
      roles: [Role.Admin],
    });
    await seedUserProfile(deskUid, {
      firstName: 'Рецепция',
      lastName: 'Права',
      roles: [Role.Receptionist],
    });

    // The front desk's own browser, on the schedule, with the ＋ open.
    await signInAs(desk, deskUid, ['receptionist']);
    await desk.goto('/staff/schedule', { waitUntil: 'commit' });
    await desk.getByTestId('staff-add-trigger').click();
    await expect(hoursRow(desk)).toBeVisible({ timeout: 30_000 });
    await expect(desk.getByTestId('staff-add-block')).toBeVisible();

    // The owner, in a browser of their own.
    const ownerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const owner = await ownerContext.newPage();
      await signInAs(owner, ownerUid, ['admin']);
      await owner.goto('/admin/team/permissions/receptionist', {
        waitUntil: 'commit',
      });
      const hours = owner.getByTestId('permission-switch-receptionist-HOURS');
      await expect(hours).toHaveAttribute('aria-checked', 'true', {
        timeout: 30_000,
      });
      await expect(owner.getByTestId('admin-permissions-save')).toHaveCount(0);

      await hours.click();
      await expect(
        owner.getByTestId('permission-receptionist-HOURS'),
      ).toContainText('Стандартно: включено');
      await owner.getByTestId('admin-permissions-save').click();
      await expect(owner.getByTestId('admin-permissions-save')).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect
        .poll(
          async () =>
            (
              await readStoredBody(Collections.Settings, STAFF_PERMISSIONS_DOC)
            )?.['receptionistHoursScope'],
          { timeout: 20_000 },
        )
        .toBe('NONE');

      // THE FRONT DESK, with no reload and no new sign-in: the row is gone
      // from the menu it had open, and blocked time — another row of
      // «Права» — is still there.
      await expect(hoursRow(desk)).toHaveCount(0, { timeout: 20_000 });
      await expect(desk.getByTestId('staff-add-block')).toBeVisible();

      // The owner puts the standard back: the row returns the same way.
      await owner.getByTestId('admin-permission-level-restore').click();
      await owner.getByTestId('admin-permissions-save').click();
      await expect(owner.getByTestId('admin-permissions-save')).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(hoursRow(desk)).toBeVisible({ timeout: 20_000 });
    } finally {
      await ownerContext.close();
    }
  });

  test('the owner reaches «Права» from the Team list, and a level’s page asks its six questions', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const uid = `e2e-perm-list-${attemptKey(test.info())}`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Екип',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    // The seeded chairs, and the owner's own account among the others.
    await expect(
      page.locator('[data-testid^="team-member-"]').first(),
    ).toBeVisible();
    await expect(page.getByTestId(`team-member-${uid}`)).toContainText(
      'Собственик Екип',
    );
    await expect(page.getByTestId('admin-team-permissions-value')).toHaveText(
      'Стандартни',
    );

    await page.getByTestId('admin-team-permissions').click();
    await expect(page).toHaveURL(/\/admin\/team\/permissions$/);
    await expect(page.getByTestId('permissions-level-admin')).toContainText(
      'Може всичко, винаги',
    );

    await page.getByTestId('permissions-level-barber').click();
    await expect(page).toHaveURL(/\/admin\/team\/permissions\/barber$/);
    await expect(
      page.locator('[data-testid^="permission-barber-"]'),
    ).toHaveCount(6);
    await expect(
      page.locator('[data-testid^="permission-value-barber-"]'),
    ).toHaveCount(5);
    await expect(
      page.getByTestId('permission-switch-barber-TEAM_MANAGE'),
    ).toHaveAttribute('aria-checked', 'false');
  });

  test('a content editor reaches the Team list for the profiles and sees no accounts; a barber is turned away', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const key = attemptKey(test.info());
    const editorUid = `e2e-perm-editor-${key}`;
    await seedUserProfile(editorUid, {
      firstName: 'Редактор',
      lastName: 'Съдържание',
      roles: [Role.ContentManager],
    });
    await signInAs(page, editorUid, ['content_manager']);

    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('admin-team-lede')).toHaveText(
      'Профилите на бръснарите.',
    );
    await expect(
      page.locator('[data-testid^="team-member-"]').first(),
    ).toBeVisible();
    // The records alone: no account is read for this person, so none is
    // listed, none is noted as missing, and «Права» is not theirs.
    await expect(page.getByTestId(`team-member-${editorUid}`)).toHaveCount(0);
    await expect(page.getByTestId('admin-team')).not.toContainText(
      'Без профил',
    );
    await expect(page.getByTestId('admin-team-permissions')).toHaveCount(0);
    await page.goto('/admin/team/permissions', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 30_000 });

    const barberUid = `e2e-perm-barber-${key}`;
    await seedUserProfile(barberUid, {
      firstName: 'Бръснар',
      lastName: 'Екип',
      roles: [Role.Barber],
    });
    await signInAs(page, barberUid, ['barber']);
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 30_000 });
  });
});
