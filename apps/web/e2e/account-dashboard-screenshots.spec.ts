import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import {
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { THEMES, pinTheme, type Theme } from './support/theme';

async function gotoAccountWithTheme(
  page: Page,
  uid: string,
  theme: Theme,
): Promise<void> {
  await pinTheme(page, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, uid, ['client']);
  await page.goto('/account');
  await expect(page.getByTestId('account-page')).toHaveAttribute(
    'data-state',
    'ready',
  );
}

/**
 * Goal 06.3 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"), once per theme
 * (`support/theme.ts`).
 *
 * The profile is three quarters done (birthday in, no photo), so the
 * completion card and its ring are part of the picture — a complete profile
 * shows no card at all.
 */
test.describe(
  'account dashboard — screenshot baseline',
  { tag: '@screenshot' },
  () => {
    for (const theme of THEMES) {
      test(`populated dashboard — ${theme}`, async ({ page }) => {
        const uid = `e2e-account-screenshot-${theme}-${test.info().testId}`;
        await seedUserProfile(uid, { birthDate: '1990-05-05' });
        await seedUpcomingAppointment(
          `appt-${uid}`,
          uid,
          '2030-06-01T10:00:00',
        );

        await gotoAccountWithTheme(page, uid, theme);
        // The next visit's state is the page's (`data-upcoming` on the host,
        // C1-1); the drawn card is the shared `lib-visit-card`.
        await expect(page.getByTestId('account-page')).toHaveAttribute(
          'data-upcoming',
          'populated',
        );
        await expect(page.getByTestId('account-upcoming')).toBeVisible();
        // The ring waits for the photo lookup (a Storage round trip).
        await expect(page.getByTestId('account-page')).toHaveAttribute(
          'data-completion',
          'open',
        );
        await expect(page).toHaveScreenshot(
          `account-dashboard-populated-${theme}.png`,
        );
        // The same settled state, once per theme: contrast differs.
        await expectNoAxeViolations(page);
      });
    }
  },
);
