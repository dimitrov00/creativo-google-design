import { expect, test, type Page } from '@playwright/test';

/**
 * Goal 06.2 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"). Unlike the landing
 * slice, these screens carry no video/live-map content, so a full-page
 * screenshot is deterministic without the hero-fold workarounds
 * `landing-screenshots.spec.ts` needed. Mirrors that spec's
 * theme-via-init-script pattern.
 */
const THEMES = ['light', 'dark'] as const;

async function gotoWithTheme(
  page: Page,
  path: string,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem('ui-theme', t);
  }, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
}

test.describe('auth — screenshot baseline', () => {
  for (const theme of THEMES) {
    test(`welcome step — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, '/auth', theme);
      await expect(page.getByTestId('auth-welcome')).toBeVisible();
      await expect(page).toHaveScreenshot(`auth-welcome-${theme}.png`);
    });

    test(`identify step — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, '/auth', theme);
      await page.getByTestId('auth-get-started').click();
      await expect(page.getByTestId('auth-identify')).toBeVisible();
      await expect(page).toHaveScreenshot(`auth-identify-${theme}.png`);
    });
  }
});
