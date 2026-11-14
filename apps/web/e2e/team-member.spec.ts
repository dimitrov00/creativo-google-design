import { type Page, expect, test } from '@playwright/test';
import { BarberStatus, Role } from '@core/components';
import { Collections } from '@core/entities';
import { attemptKey } from './support/attempt-key';
import {
  readBarberLink,
  readStoredBody,
  removeAddedBarber,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/*
 * A team member's page and the add sheet (team onboarding stage 1a; staff
 * permissions P9) against the emulators.
 *
 * The owner's case ADDS its own barber record and works on that one alone
 * — its link, its profile, its deletion — so it never moves a seeded barber
 * another spec reads, and two attempts never contend for one record.
 */
test.describe('a team member’s page', () => {
  /** The record the running case added; removed if the case stopped before deleting it. */
  let added: string | null = null;

  test.afterEach(async () => {
    if (added !== null) await removeAddedBarber(added);
    added = null;
  });

  /** The member page's id, from its address. */
  const memberIdOf = (page: Page): string =>
    decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');

  test('an owner adds a barber with a colleague’s prices, fills the profile, takes the record as their own, gives it back and deletes it', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-owner-${key}`;
    const name = `Нов Колега ${key}`.slice(0, 40);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Стол',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // THE ADD SHEET: a name, today, and Ivan's prices.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await expect(page.getByTestId('team-add-save')).toBeDisabled();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-copy').click();
    await page
      .locator('[role^="menuitem"]', { hasText: 'Иван Колев' })
      .first()
      .click();
    await expect(page.getByTestId('team-add-copy')).toContainText('Иван Колев');
    await page.getByTestId('team-add-save').click();

    // THE NEW RECORD'S PAGE: in preparation, the prices there, the hours not.
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-name')).toHaveText(name, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-standing')).toContainText('4 от 5', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-setup-SERVICES')).toHaveAttribute(
      'data-done',
      '',
    );
    await expect(page.getByTestId('member-setup-HOURS')).toContainText('Няма');
    const stored = await readStoredBody(Collections.Barbers, added);
    expect(stored?.['barberStatus']).toBe(BarberStatus.Draft);
    expect(stored?.['barberJoinsAnyPool']).toBe(true);

    // THE PROFILE: a title, saved from the sheet, shows on its row.
    await page.getByTestId('member-row-profile').click();
    await expect(page.getByTestId('member-profile-name')).toHaveValue(name);
    await page.getByTestId('member-profile-position').fill('Младши бръснар');
    await page.getByTestId('member-profile-save').click();
    await expect(page.getByTestId('member-row-profile')).toContainText(
      'Младши бръснар',
      { timeout: 30_000 },
    );
    await expect
      .poll(
        async () =>
          (await readStoredBody(Collections.Barbers, added ?? ''))?.['title'],
        { timeout: 20_000 },
      )
      .toEqual({ bg: 'Младши бръснар', en: 'Младши бръснар' });

    // THE PERIOD: a last day that is not set yet opens on a month with
    // days in it; picking one keeps the keyboard inside the sheet, so
    // Escape still closes it — and nothing was saved.
    await page.getByTestId('member-row-period').click();
    await page.getByTestId('member-period-last').click();
    await page
      .getByTestId('member-period-last-calendar')
      .locator('[data-testid^="ui-month-day-"]')
      .last()
      .click();
    await expect(page.getByTestId('member-period-last-clear')).toBeVisible();
    await expect(page.getByTestId('member-period-save')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('member-period-sheet')).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(
      (await readStoredBody(Collections.Barbers, added))?.[
        'barberLastWorkingLocalDate'
      ],
    ).toBeNull();

    // THE POOL: one switch, one part of the record.
    await page.getByTestId('member-pool').click();
    await expect
      .poll(
        async () =>
          (await readStoredBody(Collections.Barbers, added ?? ''))?.[
            'barberJoinsAnyPool'
          ],
        { timeout: 20_000 },
      )
      .toBe(false);

    // «ТОВА СЪМ АЗ»: the owner's own account takes the record — and nobody
    // is signed out.
    await page.getByTestId('member-is-me').click();
    await expect(page.getByTestId('member-not-me')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-account-linked')).toContainText(
      'Собственик Стол',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-account-linked')).toContainText(
      'Твоят профил',
    );
    expect(await readBarberLink(added)).toBe(uid);
    const account = await readStoredBody(Collections.Users, uid);
    expect(account?.['linkedBarberId']).toBe(added);
    expect(account?.['roles']).toEqual(
      expect.arrayContaining(['admin', 'barber']),
    );
    // The level the account now holds leads to «Права».
    await expect(page.getByTestId('member-level-barber')).toHaveAttribute(
      'href',
      '/admin/team/permissions/barber',
    );

    // «НЕ СЪМ АЗ»: the exact way back.
    await page.getByTestId('member-not-me').click();
    await expect(page.getByTestId('member-is-me')).toBeVisible({
      timeout: 30_000,
    });
    expect(await readBarberLink(added)).toBeNull();
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      'admin',
    ]);

    // «ИЗТРИЙ»: asks first, then the record is gone from the list.
    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    await expect(page.getByTestId(`team-member-${added}`)).toHaveCount(0, {
      timeout: 30_000,
    });
    expect(await readStoredBody(Collections.Barbers, added)).toBeNull();
    added = null;
  });

  test('a content editor reaches a barber’s profile from the Team list, and sees no account, no period editor and no delete', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const uid = `e2e-member-editor-${attemptKey(test.info())}`;
    await seedUserProfile(uid, {
      firstName: 'Редактор',
      lastName: 'Профили',
      roles: [Role.ContentManager],
    });
    await signInAs(page, uid, ['content_manager']);

    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    // Adding someone is the manager's.
    await expect(page.getByTestId('admin-team-add')).toHaveCount(0);

    await page.getByTestId('team-member-ivan').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/ivan$/);
    await expect(page.getByTestId('member-standing')).toHaveText(
      'Приема записи',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-account')).toHaveCount(0);
    await expect(page.getByTestId('member-is-me')).toHaveCount(0);
    await expect(page.getByTestId('member-delete')).toHaveCount(0);
    await expect(page.getByTestId('member-pool')).toBeDisabled();

    // The profile is theirs to edit: the sheet opens on the record.
    await page.getByTestId('member-row-profile').click();
    await expect(page.getByTestId('member-profile-name')).toHaveValue(/Иван/);
    await expect(page.getByTestId('member-profile-save')).toBeDisabled();
  });
});
