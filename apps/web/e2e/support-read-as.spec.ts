import { expect, test } from '@playwright/test';
import { Role } from '@core/components';
import { seedUserProfile } from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/*
 * THE SUPPORT READ-AS, END TO END (OR-24, docs/designs/support-read-as.md):
 * the vendor's sysadmin finds the shop's owner on «Поддръжка», gives a
 * reason, and lands in the app AS the owner — the banner on every page, a
 * save refused (the edge closes every write to a read-as token), and
 * «Край» ending it all at the sign-in. The owner's admin may not start one.
 */

/** A family name no other spec seeds, so the lookup finds this owner alone. */
const FAMILY = 'Четирсторасков';

test.describe('support read-as', () => {
  test('the sysadmin reads the app as the owner — read-only, the banner on — and «Край» signs out', async ({
    page,
  }) => {
    // Two sign-ins, a lookup, a server mint and a refused save.
    test.setTimeout(120_000);
    const id = test.info().testId;
    const supportUid = `e2e-support-${id}`;
    const ownerUid = `e2e-readas-owner-${id}`;
    await seedUserProfile(ownerUid, {
      firstName: 'Александър',
      lastName: FAMILY,
      roles: [Role.Client, Role.Barber, Role.Admin],
    });
    await seedUserProfile(supportUid, {
      firstName: 'Поддръжка',
      lastName: 'Вендор',
      roles: [Role.Sysadmin],
    });
    await signInAs(page, supportUid, [Role.Sysadmin]);

    // «Поддръжка» → the one lookup sheet → the owner's row.
    await page.goto('/support');
    await page.getByTestId('support-find').click();
    await page.getByTestId('support-lookup-query').fill(FAMILY);
    const row = page.getByTestId(`support-account-${ownerUid}`);
    await expect(row).toContainText(`Александър ${FAMILY}`, {
      timeout: 30_000,
    });
    await row.click();

    // The reason, then «Започни»: the browser's one session becomes the owner's.
    await expect(page.getByTestId('read-as-start')).toBeDisabled({
      timeout: 30_000,
    });
    await page.getByTestId('read-as-reason').fill('e2e support ticket 42');
    await page.getByTestId('read-as-start').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });

    const banner = page.getByTestId('read-as-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('read-as-title')).toContainText(
      'Действаш като',
    );

    // A write is refused: the profile's save goes to a callable the
    // read-as table closes.
    await page.goto('/account/profile');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('profile-row-name').click();
    await page.getByTestId('profile-first-name').fill('Променено');
    await page.getByTestId('profile-sheet-save').click();
    await expect(page.getByTestId('profile-sheet-error')).toBeVisible({
      timeout: 30_000,
    });
    // The sheet is modal — the page behind it, the banner included, waits.
    await page.getByRole('button', { name: 'Затвори' }).click();
    await expect(page.getByTestId('profile-sheet-error')).toHaveCount(0);

    // «Край»: ended on the server, signed out, at the sign-in.
    await page.getByTestId('read-as-end').click();
    await expect(page).toHaveURL(/\/auth/, { timeout: 30_000 });
    await expect(banner).toHaveCount(0);
  });

  test('the shop’s admin finds no «Поддръжка» — the page is the sysadmin’s alone', async ({
    page,
  }) => {
    const uid = `e2e-readas-admin-${test.info().testId}`;
    await seedUserProfile(uid, { roles: [Role.Admin] });
    await signInAs(page, uid, [Role.Admin]);
    await page.goto('/support');
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
