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

async function gotoAccountWithTheme(
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
  await page.goto('/account');
  await expect(page.getByTestId('account-page')).toHaveAttribute(
    'data-state',
    'ready',
  );
}

/**
 * Goal 06.3 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"). Mirrors
 * `auth-onboarding-screenshots.spec.ts`'s theme-via-init-script pattern.
 */
test.describe('account dashboard — screenshot baseline', () => {
  for (const theme of THEMES) {
    test(`populated dashboard — ${theme}`, async ({ page }) => {
      const uid = `e2e-account-screenshot-${theme}-${test.info().testId}`;
      await seedUserProfile(uid, { birthDate: '1990-05-05' });
      await seedUpcomingAppointment(`appt-${uid}`, uid, '2030-06-01T10:00:00');

      await gotoAccountWithTheme(page, uid, theme);
      await expect(page.getByTestId('account-upcoming')).toHaveAttribute(
        'data-state',
        'populated',
      );
      await expect(page).toHaveScreenshot(
        `account-dashboard-populated-${theme}.png`,
      );
    });
  }
});
