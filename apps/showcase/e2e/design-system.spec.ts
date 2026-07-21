import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 1 exit gate (docs/migration-blueprint.md §8): screenshot-diff
 * baselines for every showcase control, light + dark, via `data-theme`.
 * `DesignSystemPreferences` (apps/showcase/src/app/design-system-preferences.service.ts)
 * reads `localStorage['showcase-theme']` once at bootstrap, so the theme is
 * fixed with an init script BEFORE navigation rather than toggled after —
 * that's the only way to get a deterministic first paint per theme.
 */
const CONTROL_ROUTES = [
  'controls/button',
  'controls/input',
  'controls/otp-field',
  'controls/chip',
  'controls/badge',
  'controls/avatar',
  'controls/spinner',
  'controls/skeleton',
  'controls/stack',
  'controls/toolbar',
  'controls/sheet',
  'controls/card',
] as const;

const THEMES = ['light', 'dark'] as const;

async function gotoWithTheme(
  page: Page,
  route: string,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem('showcase-theme', t);
  }, theme);
  await page.goto(`/${route}`);
  // No networkidle wait (flaky/discouraged) — `toHaveScreenshot` below
  // already auto-retries until the page is visually stable.
}

test.describe('design system — token catalog', () => {
  for (const theme of THEMES) {
    test(`tokens page — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, 'tokens', theme);
      await expect(page).toHaveScreenshot(`tokens-${theme}.png`, {
        fullPage: true,
      });
    });
  }
});

test.describe('design system — controls index', () => {
  for (const theme of THEMES) {
    test(`controls index — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, 'controls', theme);
      await expect(page).toHaveScreenshot(`controls-index-${theme}.png`, {
        fullPage: true,
      });
    });
  }
});

for (const route of CONTROL_ROUTES) {
  const slug = route.split('/')[1];

  test.describe(`design system — ${slug}`, () => {
    for (const theme of THEMES) {
      test(`${slug} — ${theme}`, async ({ page }) => {
        await gotoWithTheme(page, route, theme);
        await expect(page).toHaveScreenshot(`${slug}-${theme}.png`, {
          fullPage: true,
        });
      });
    }
  });
}
