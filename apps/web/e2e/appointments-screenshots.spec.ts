import { expect, test, type Page } from '@playwright/test';
import { mintCustomToken } from './support/mint-custom-token';
import {
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

const THEMES = ['light', 'dark'] as const;

async function gotoAppointmentsWithTheme(
  page: Page,
  uid: string,
  theme: (typeof THEMES)[number],
): Promise<void> {
  const token = await mintCustomToken(uid, {
    stage: 'active',
    roles: ['client'],
  });
  await page.addInitScript((t) => {
    window.localStorage.setItem('ui-theme', t);
  }, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
  await page.evaluate(
    (customToken) => window.__e2eSignIn?.(customToken),
    token,
  );
  await page.goto('/account/appointments');
  await expect(page.getByTestId('appointments-page')).toHaveAttribute(
    'data-state',
    'ready',
  );
}

/**
 * Goal 6.4 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"). Mirrors
 * `account-dashboard-screenshots.spec.ts`'s theme-via-init-script pattern.
 */
test.describe('account appointments — screenshot baseline', () => {
  for (const theme of THEMES) {
    test(`populated list view — ${theme}`, async ({ page }) => {
      const uid = `e2e-appts-screenshot-${theme}-${test.info().testId}`;
      await seedUserProfile(uid);
      await seedUpcomingAppointment(`appt-${uid}`, uid, '2030-06-01T10:00:00');

      await gotoAppointmentsWithTheme(page, uid, theme);
      await expect(page.getByTestId('appointments-list')).toHaveAttribute(
        'data-state',
        'populated',
      );
      await expect(page).toHaveScreenshot(
        `appointments-list-populated-${theme}.png`,
      );
    });

    test(`calendar view — ${theme}`, async ({ page }) => {
      const uid = `e2e-appts-calendar-screenshot-${theme}-${test.info().testId}`;
      await seedUserProfile(uid);
      await seedUpcomingAppointment(`appt-${uid}`, uid, '2030-06-01T10:00:00');

      await gotoAppointmentsWithTheme(page, uid, theme);
      await page.getByTestId('appointments-view-calendar').click();
      await expect(page.getByTestId('appointments-calendar')).toBeVisible();
      await expect(page).toHaveScreenshot(`appointments-calendar-${theme}.png`);
    });
  }
});
