import { expect, test } from '@playwright/test';
import { AuditAction, Role } from '@core/components';
import { Collections } from '@core/entities';
import { attemptKey } from './support/attempt-key';
import {
  readAuditActionsFor,
  readStoredBody,
  removeUserProfile,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/*
 * A staff account's page (team onboarding D8; staff permissions P10)
 * against the emulators: the owner opens a colleague with no barber record
 * from the Team list, gives them a second role, and takes them off the
 * team.
 *
 * Each attempt seeds its OWN front-desk account (a run-unique uid) and
 * works on that one alone, so it never moves an account another spec
 * signs in as. The account holds no Auth user, so the revoke after each
 * change answers `auth/user-not-found`, which `setRoles` reads as done.
 */
test.describe('a staff account’s page', () => {
  /** The account the running case seeded as staff; removed if the case stopped before taking it off the team. */
  let staffUid: string | null = null;

  test.afterEach(async () => {
    if (staffUid !== null) await removeUserProfile(staffUid);
    staffUid = null;
  });

  test('an owner opens a front-desk colleague from the Team list, adds «Съдържание», follows the level to «Права», and takes them off the team', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-account-owner-${key}`;
    const deskUid = `e2e-account-desk-${key}`;
    const name = `Рада Екип${key}`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Роли',
      roles: [Role.Admin],
    });
    await seedUserProfile(deskUid, {
      firstName: 'Рада',
      lastName: `Екип${key}`,
      roles: [Role.Client, Role.Receptionist],
    });
    staffUid = deskUid;
    await signInAs(page, uid, ['admin']);

    // THE TEAM LIST: the colleague's row leads to their own page.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId(`team-member-${deskUid}`).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `/admin/team/account/${deskUid}`,
    );
    await expect(page.getByTestId('account-name')).toHaveText(name, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('account-line')).toHaveText('Рецепция');
    await expect(page.getByTestId('account-role-receptionist')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Nothing is drafted yet, and «Бръснар» is not this page's to give.
    await expect(page.getByTestId('account-dock')).toHaveCount(0);
    await expect(page.getByTestId('account-role-barber')).toHaveCount(0);

    // A SECOND ROLE: ticked, saved as the whole set, said once.
    await page.getByTestId('account-role-content_manager').click();
    await page.getByTestId('account-save').click();
    await expect(page.getByTestId('account-saved-toast')).toContainText(
      'Ролите са запазени',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('account-line')).toHaveText(
      'Рецепция, Съдържание',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('account-dock')).toHaveCount(0);
    expect(
      (await readStoredBody(Collections.Users, deskUid))?.['roles'],
    ).toEqual([Role.Client, Role.Receptionist, Role.ContentManager]);
    // The owner's own account did not move.
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      Role.Admin,
    ]);

    // Each level held leads to its page on «Права».
    await expect(
      page.getByTestId('account-level-content_manager'),
    ).toHaveAttribute('href', '/admin/team/permissions/content_manager');
    await expect(
      page.getByTestId('account-level-receptionist'),
    ).toHaveAttribute('href', '/admin/team/permissions/receptionist');

    // «МАХНИ ОТ ЕКИПА»: asked first; the account stays, as a client, and
    // the list no longer holds it.
    await page.getByTestId('account-remove').click();
    await expect(page.getByTestId('account-remove-question')).toContainText(
      `Да махна ли ${name} от екипа?`,
    );
    await page.getByTestId('account-remove-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    expect(
      (await readStoredBody(Collections.Users, deskUid))?.['roles'],
    ).toEqual([Role.Client]);
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId(`team-member-${deskUid}`)).toHaveCount(0);
    staffUid = null;
  });

  test('an owner gives a registered client the front desk from the ＋: found by a lookup, asked first, the stored account holds the role and their page opens', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-account-adder-${key}`;
    const clientUid = `e2e-account-added-${key}`;
    // A family name nobody else holds: the lookup finds this account alone.
    const family = `Нова${key}`;
    const name = `Елена ${family}`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Добавя',
      roles: [Role.Admin],
    });
    await seedUserProfile(clientUid, {
      firstName: 'Елена',
      lastName: family,
      phone: '+359881112288',
    });
    staffUid = clientUid;
    await signInAs(page, uid, ['admin']);

    // THE ＋ IS A MENU for the owner: a barber, or a role for an account.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId(`team-member-${clientUid}`)).toHaveCount(0);
    await page.getByTestId('admin-team-add').click();
    await expect(page.getByTestId('admin-team-add-barber')).toBeVisible();
    await page.getByTestId('admin-team-add-receptionist').click();

    // «ДОБАВИ В ЕКИПА»: the lookup finds the registered client by family
    // name; the row asks first, and says the person signs in again.
    await expect(page.getByTestId('team-role-sheet')).toContainText(
      'роля „Рецепция“',
      { timeout: 30_000 },
    );
    await page.getByTestId('team-role-query').fill(family);
    const found = page.getByTestId(`team-role-${clientUid}`);
    await expect(found).toContainText(name, { timeout: 30_000 });
    await found.click();
    await expect(page.getByTestId('team-role-question')).toContainText(
      `Да дам ли на ${name} роля „Рецепция“?`,
    );
    await expect(page.getByTestId('team-role-question')).toContainText(
      'ще трябва да влезе отново',
    );
    await page.getByTestId('team-role-confirm').click();

    // Added: the sheet leaves and the account's own page opens, on the
    // role it was given; the stored account holds it beside «client», and
    // the change is on the audit log.
    await expect(page).toHaveURL(
      (url) => url.pathname === `/admin/team/account/${clientUid}`,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('account-name')).toHaveText(name, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('account-line')).toHaveText('Рецепция');
    await expect(page.getByTestId('account-role-receptionist')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      (await readStoredBody(Collections.Users, clientUid))?.['roles'],
    ).toEqual([Role.Client, Role.Receptionist]);
    expect(await readAuditActionsFor(clientUid)).toContain(
      AuditAction.ProfileRolesChanged,
    );
    // The owner's own account did not move.
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      Role.Admin,
    ]);

    // Back on the list they stand under «Още в екипа».
    await page.getByTestId('admin-team-account-back').click();
    await expect(page.getByTestId(`team-member-${clientUid}`)).toContainText(
      'Рецепция',
      { timeout: 30_000 },
    );
    // The account is the `afterEach`'s to remove.
  });

  test('the owner’s own account is read: no tick to turn, no way off the team', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const key = attemptKey(test.info());
    const uid = `e2e-account-self-${key}`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Сам',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    await page.goto(`/admin/team/account/${uid}`, { waitUntil: 'commit' });
    await expect(page.getByTestId('account-name')).toHaveText(
      'Собственик Сам',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('account-note')).toHaveText(
      'Това е твоят профил. Ролите му не се променят оттук.',
    );
    await expect(page.getByTestId('account-role-receptionist')).toHaveCount(0);
    await expect(page.getByTestId('account-remove')).toHaveCount(0);
  });
});
