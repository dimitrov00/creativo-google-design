import { expect, test, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { mintActiveToken } from './support/sign-in';

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
/**
 * The path a bundled chunk names a `maplibre-gl` module by
 * (`// node_modules/.pnpm/maplibre-gl@6.16.0/node_modules/maplibre-gl/dist/maplibre-gl.mjs`,
 * and its `maplibre-gl.css` text twin).
 */
const MAPLIBRE_MODULE = /\/maplibre-gl\/dist\/maplibre-gl\.(?:mjs|css)\b/;

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
    // The footer is the shared shell's now (`cr-site-footer`), the same one
    // the careers and courses pages close on.
    await expect(page.getByTestId('site-footer')).toBeVisible();
  });

  /*
   * The copy must paint over the half-strength film on every path that
   * leaves it unlifted. A running (or filling) animation promotes the copy
   * into a layer of its own, which is what hid the bug: the film — a
   * positioned layer — painted over the headline and greyed it out wherever
   * none was running.
   *   - reduced motion: no reveal, no scroll exit;
   *   - no scroll-driven animations (Firefox; iOS Safari before 26): the
   *     `@supports (animation-timeline)` exits are simply absent, and the
   *     reveal (`fill: 'backwards'`) lets go of the copy once it finishes.
   * The z-stack must keep source order on its own.
   */
  for (const path of [
    { name: 'under reduced motion', reducedMotion: 'reduce' as const },
    {
      name: 'without scroll-driven animations',
      reducedMotion: 'no-preference' as const,
    },
  ]) {
    test(`the hero headline paints over its film ${path.name}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: path.reducedMotion });
      await page.goto('/');
      const hero = page.getByTestId('landing-hero');
      const heading = hero.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();

      // What a browser without `animation-timeline` renders: none of the
      // gated scroll exits (the only CSS animations up here)… (Under
      // reduced motion neither step has anything to do.)
      await page.addStyleTag({
        content: '*, *::before, *::after { animation: none !important; }',
      });
      // …and the entrance reveals played out and released.
      await hero.evaluate(async (root) => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => {
              const target = (animation.effect as KeyframeEffect | null)
                ?.target;
              return target != null && root.contains(target);
            })
            .map((animation) => animation.finished),
        );
      });

      // A hit test is a paint-order probe only for layers that take part in
      // hit testing: a decorative film with `pointer-events: none` would be
      // skipped and the probe would pass while the film covered the copy.
      // So every layer of the hero takes part, whatever it declares.
      await page.addStyleTag({
        content:
          '[data-testid="landing-hero"] *, [data-testid="landing-hero"] *::before, [data-testid="landing-hero"] *::after { pointer-events: auto !important; }',
      });

      const topmostIsHeading = await heading.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit !== null && element.contains(hit);
      });
      expect(topmostIsHeading).toBe(true);
    });
  }

  test('MapLibre only loads once the locations section is in view', async ({
    page,
  }) => {
    // A MapLibre download is known by what it CARRIES, not by its URL. Since
    // c1db6611 (2026-10-07) the dev server no longer prebundles `maplibre-gl`
    // (`apps/web/project.json` `prebundle.exclude`, so the loader's
    // `loader: 'text'` stylesheet import can work — see `MapLibreLoader`): the
    // library and its stylesheet are bundled into hashed lazy chunks
    // (`chunk-XXXXXXXX.js`), exactly as a production build ships them, and no
    // URL names the package any more. A non-minified chunk opens each module
    // it bundles with its source path (`// node_modules/…/maplibre-gl/dist/…`),
    // so that is the identity read here; a URL naming the package (a
    // prebundled or unbundled dependency) still counts.
    const mapLibreDownloads: string[] = [];
    const reads: Promise<void>[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (/maplibre-gl/i.test(url)) {
        mapLibreDownloads.push(url);
        return;
      }
      const type = response.request().resourceType();
      if (type !== 'script' && type !== 'stylesheet') return;
      reads.push(
        response
          .text()
          .then((body) => {
            if (MAPLIBRE_MODULE.test(body)) mapLibreDownloads.push(url);
          })
          // A body the page no longer holds (a redirect, a closed page) is
          // not a download this test can attribute.
          .catch(() => undefined),
      );
    });

    await page.goto('/');
    await expect(page.getByTestId('landing-hero')).toBeVisible();
    // Above-the-fold only — the locations section hasn't been scrolled to,
    // so its `@defer (on viewport)` block (and the dynamic `import('maplibre-gl')`
    // inside locations.component.ts) must not have fired yet.
    await Promise.all(reads);
    expect(mapLibreDownloads).toHaveLength(0);

    // The locations testid only exists once its `@defer (on viewport)` block
    // has hydrated — scroll the whole page first (its placeholder anchor,
    // `#locations`, is what the viewport trigger actually observes).
    await scrollThroughPage(page);
    await expect(page.getByTestId('landing-locations')).toBeVisible();
    await expect(page.locator('[data-locations-map]')).toBeVisible();
    await expect
      .poll(
        async () => {
          await Promise.all(reads);
          return mapLibreDownloads.length;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test('installed-PWA active-user launch redirects / to /account', async ({
    page,
  }) => {
    const uid = `e2e-standalone-${test.info().testId}`;
    const token = await mintActiveToken(uid, [Role.Client]);

    // Chromium has no native "launch as installed PWA" affordance for
    // Playwright to drive, so `display-mode: standalone` is forced the same
    // way home.guard.spec.ts does at the unit level — this test's job is to
    // prove the guard's real DI wiring (AUTH_SESSION_PORTS, Router) behaves the
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
