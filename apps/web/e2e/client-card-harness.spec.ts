import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { seedUserProfile } from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { THEMES, pinTheme } from './support/theme';

/**
 * Proves the client-details harness (design §12.4 P0) before any client
 * page exists: `signInAs` and `expectNoAxeViolations` on today's pages, run
 * once per viewport project (phone, tablet, desktop) and, for axe, once per
 * theme. `runJob` is not
 * exercised: it refuses until P2 wires its first job.
 */
test.describe('client-details harness', () => {
  // Once per theme, as `expectNoAxeViolations` asks: contrast differs.
  for (const theme of THEMES) {
    test(`a seeded client signs in and /account passes axe — ${theme}`, async ({
      page,
    }) => {
      const uid = `e2e-harness-client-${test.info().testId}`;
      await seedUserProfile(uid, { birthDate: '1990-05-05' });
      await pinTheme(page, theme);
      await signInAs(page, uid, ['client']);

      await page.goto('/account');
      await expect(page.getByTestId('account-page')).toHaveAttribute(
        'data-state',
        'ready',
      );
      // The theme the scan is about, not the device's: a pinned theme that
      // failed to apply would scan the other one and pass for the wrong
      // reason.
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // No waivers: the bordered "book" CTA's label was 4.3:1 on its 12% wash
      // until the accent ink was re-cut (2026-09-25, 5.11:1 on this card).
      await expectNoAxeViolations(page);
    });
  }

  test('the roles reach the guards: a receptionist opens the schedule', async ({
    page,
  }) => {
    const uid = `e2e-harness-staff-${test.info().testId}`;
    await signInAs(page, uid, ['receptionist']);

    await page.goto('/staff/schedule');
    // The dashboard's own control, not just the URL: `goto` can settle before
    // the role guard has run, so a URL check alone could pass on a page that
    // is about to become /forbidden.
    await expect(page.getByTestId('staff-view-segments')).toBeAttached();
    await expect(page).toHaveURL(/\/staff\/schedule/);
  });
});
