import { expect, test, type Page } from '@playwright/test';

/**
 * Goal 06.1 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"). Scoped to the hero
 * fold only, not full-page: the locations section renders a live MapLibre
 * canvas fed by network tiles and several sections carry autoplaying video,
 * neither of which paints deterministically in CI — see `landing.spec.ts`
 * for the functional (non-visual) assertions covering those sections.
 * Mirrors `apps/showcase/e2e/design-system.spec.ts`'s theme-via-init-script
 * + no-networkidle-wait pattern.
 */
const THEMES = ['light', 'dark'] as const;

async function gotoWithTheme(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem('ui-theme', t);
  }, theme);
  // The hero film autoplays — a pause-after-goto race (video decodes a frame
  // or two before the pause call lands) is exactly what produces a
  // never-settles screenshot diff, so playback is killed before any app
  // script runs rather than raced after navigation.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('landing-hero')).toBeVisible();
  // Belt-and-suspenders: reduced-motion is honored by the app's own JS
  // (home.page.ts's `data-motion-ready` gate), but the custom cursor dot
  // and any other host-level CSS transition aren't gated on it — freeze
  // everything for a deterministic screenshot.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition: none !important;
        /* backdrop-filter blur (the hero language pill) re-samples the
           frame it sits over every paint — genuinely non-deterministic
           pixel-for-pixel between two otherwise-identical captures in a
           headless compositor, so it's dropped for this baseline only. */
        backdrop-filter: none !important;
      }
      cr-cursor-dot { display: none !important; }
    `,
  });
}

test.describe('marketing landing — hero screenshot baseline', () => {
  for (const theme of THEMES) {
    test(`hero fold — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, theme);
      // A cinematic video hero never reaches pixel-for-pixel determinism in
      // a headless compositor (poster/video-frame decode timing) — a small
      // tolerance is the honest trade-off; anything beyond it still fails.
      await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`, {
        maxDiffPixelRatio: 0.08,
      });
    });
  }
});
