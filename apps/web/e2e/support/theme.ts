import type { Page } from '@playwright/test';

/** The app's two appearances. Contrast differs between them, so a
 *  screenshot baseline or an axe scan runs once per theme. */
export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/**
 * Opens every later navigation of `page` in `theme`: the `ui-theme` key the
 * app's pre-paint script reads (`apps/web/src/index.html`, `THEME_STORAGE_KEY`
 * in `libs/ui/tokens`) is written before any app script runs, so the first
 * paint is already in that theme. Call it before the first `goto`.
 */
export async function pinTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('ui-theme', value);
  }, theme);
}
