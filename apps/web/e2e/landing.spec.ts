import { expect, test, type Page } from '@playwright/test';
import { mintCustomToken } from './support/mint-custom-token';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

/**
 * Goal 06.1 exit gate (docs/migration/goals/06-feature-slices.md) — the
 * marketing landing slice: every section renders (including the ones behind
 * `@defer (on viewport)`), MapLibre only loads once the locations section is
 * in view, and an installed-PWA active-user launch skips straight to
 * `/account` (home.guard.spec.ts covers the same branch as a fast unit test;
 * this proves it end-to-end against a real session).
 */
async function scrollThroughPage(page: Page): Promise<void> {
  // Forces every `@defer (on viewport)` section to hydrate — the page has
  // no infinite scroll/virtualization, so a few full-viewport steps reach
  // the bottom reliably regardless of section height.
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 600);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

test.describe('marketing landing', () => {
  test('renders every section, including deferred ones', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-hero')).toBeVisible();
    await expect(page.getByTestId('landing-hero-cta')).toBeVisible();

    await scrollThroughPage(page);

    await expect(page.getByTestId('landing-work-gallery')).toBeVisible();
    await expect(page.getByTestId('landing-barbers')).toBeVisible();
    await expect(page.getByTestId('landing-services')).toBeVisible();
    await expect(page.getByTestId('landing-hiring')).toBeVisible();
    await expect(page.getByTestId('landing-locations')).toBeVisible();
    await expect(page.getByTestId('landing-closing-cta')).toBeVisible();
    await expect(page.getByTestId('landing-footer')).toBeVisible();
  });

  test('MapLibre only loads once the locations section is in view', async ({
    page,
  }) => {
    const mapLibreRequests: string[] = [];
    page.on('request', (request) => {
      if (/maplibre-gl/i.test(request.url()))
        mapLibreRequests.push(request.url());
    });

    await page.goto('/');
    await expect(page.getByTestId('landing-hero')).toBeVisible();
    // Above-the-fold only — the locations section hasn't been scrolled to,
    // so its `@defer (on viewport)` block (and the dynamic `import('maplibre-gl')`
    // inside locations.component.ts) must not have fired yet.
    expect(mapLibreRequests).toHaveLength(0);

    // The locations testid only exists once its `@defer (on viewport)` block
    // has hydrated — scroll the whole page first (its placeholder anchor,
    // `#locations`, is what the viewport trigger actually observes).
    await scrollThroughPage(page);
    await expect(page.getByTestId('landing-locations')).toBeVisible();
    await expect(page.locator('[data-locations-map]')).toBeVisible();
    await expect
      .poll(() => mapLibreRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test('installed-PWA active-user launch redirects / to /account', async ({
    page,
  }) => {
    const uid = `e2e-standalone-${test.info().testId}`;
    const token = await mintCustomToken(uid, {
      stage: 'active',
      roles: ['client'],
    });

    // Chromium has no native "launch as installed PWA" affordance for
    // Playwright to drive, so `display-mode: standalone` is forced the same
    // way home.guard.spec.ts does at the unit level — this test's job is to
    // prove the guard's real DI wiring (AUTH_GATEWAY, Router) behaves the
    // same end-to-end, not to re-derive `isStandalone()`'s own logic.
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

    await page.goto('/');
    await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
    await page.evaluate(
      (customToken) => window.__e2eSignIn?.(customToken),
      token,
    );

    await page.goto('/');
    await expect(page).toHaveURL(/\/account$/);
  });

  test('standalone launch by an anonymous visitor still sees the landing page', async ({
    page,
  }) => {
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

    await page.goto('/');
    await expect(page).toHaveURL(/^[^?]*\/$/);
    await expect(page.getByTestId('landing-hero')).toBeVisible();
  });
});
