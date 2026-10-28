import { expect, test, type Page } from '@playwright/test';
import { THEMES, pinTheme, type Theme } from './support/theme';

/**
 * Goal 06.2 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"). Unlike the landing
 * slice, these screens carry no video/live-map content, so a full-page
 * screenshot is deterministic without the hero-fold workarounds
 * `landing-screenshots.spec.ts` needed. Once per theme
 * (`support/theme.ts`).
 */
async function gotoWithTheme(
  page: Page,
  path: string,
  theme: Theme,
): Promise<void> {
  await pinTheme(page, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
}

test.describe('auth — screenshot baseline', { tag: '@screenshot' }, () => {
  for (const theme of THEMES) {
    // The welcome interstitial is retired (auth-flow design §1.5) — the
    // flow opens directly on identify, which now carries the brand trio.
    test(`identify step — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, '/auth', theme);
      await expect(page.getByTestId('auth-identify')).toBeVisible();
      await expect(page).toHaveScreenshot(`auth-identify-${theme}.png`);
    });
  }
});
