import { expect, test, type Page } from '@playwright/test';

/**
 * Goal 06.1 visual-parity gate. The baseline PNGs in
 * `landing-screenshots.spec.ts-snapshots/` are captured from *running v2*
 * by `tools/capture-v2-landing-baselines.mjs` — NEVER regenerate them with
 * `--update-snapshots` against this app (that produced a self-referential
 * "parity" claim once; see the Visual-parity evidence rule in
 * docs/migration/v2-parity-checklist.md). This spec renders the Angular
 * landing under the same determinism setup the capture script uses and
 * diffs the hero fold against v2's pixels.
 *
 * Scoped to the hero fold only, not full-page: the locations section
 * renders a live MapLibre canvas fed by network tiles and several sections
 * carry autoplaying video, neither of which paints deterministically in CI
 * — see `landing.spec.ts` for the functional assertions covering those.
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
  // Freeze animations + backdrop-filter for a deterministic capture —
  // byte-identical to the capture script's FREEZE_CSS.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition: none !important;
        backdrop-filter: none !important;
      }
    `,
  });
}

test.describe('marketing landing — hero visual parity vs v2', () => {
  for (const theme of THEMES) {
    test(`hero fold — ${theme}`, async ({ page }) => {
      await gotoWithTheme(page, theme);
      // Cross-app parity (Angular render vs v2 render) can't be
      // pixel-for-pixel: video poster decode and font rasterization differ
      // between two runs even of the SAME app. The checklist's cross-cutting
      // target is ≤1% pixel delta on key pages (Goal 08 audits); the hero
      // gate here uses the same envelope.
      await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
