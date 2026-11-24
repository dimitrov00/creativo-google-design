import type { Page } from '@playwright/test';

/**
 * Makes the page answer `(display-mode: standalone)` as an INSTALLED app
 * does, before any app script runs. Chromium has no native "launch as
 * installed PWA" affordance for Playwright to drive, so the media query is
 * forced the same way `home.guard.spec.ts` does at the unit level — a spec
 * using it proves the real DI wiring (the home gate, the router) behaves the
 * same end to end, not `isStandalone()`'s own logic.
 */
export async function emulateInstalledApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) =>
      query === '(display-mode: standalone)'
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
          } as MediaQueryList)
        : original(query)) as typeof window.matchMedia;
  });
}
