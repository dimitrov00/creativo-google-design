import { expect, test, type Page } from '@playwright/test';
import { THEMES, pinTheme, type Theme } from './support/theme';

/**
 * Goal 06.1 hero visual REGRESSION gate, scoped to the hero fold under a
 * deterministic setup (reduced motion, video playback stubbed, animations
 * and backdrop-filter frozen).
 *
 * NOT a v2 parity gate any more, and named so. The baselines were first
 * captured from *running v2* (`tools/capture-v2-landing-baselines.mjs`), and
 * while the hero was a v2 port that is what this gate proved
 * (docs/migration/v2-parity-checklist.md, "Visual-parity evidence rule").
 * The hero left v2 on purpose on 2026-07-22 — the landing case study's
 * closing-CTA register (docs/design-research/landing-uiux-case-study.md §3,
 * shipped in 97b3121): the booking capsule sits under the film card, not on
 * it — so no v2 capture can match it. Since 2026-09-25 the baselines are
 * the SHIPPED hero, captured from this app and reviewed by eye; the
 * checklist's landing row records the retirement. What this proves is that
 * the hero has not changed by accident — never that it matches v2.
 *
 * The v2 capture script writes to its own folder (`dist/v2-parity/landing/`)
 * and refuses this one, so a parity audit can compare against v2 side by
 * side without overwriting these baselines.
 *
 * Scoped to the hero fold only, not full-page: the locations section
 * renders a live MapLibre canvas fed by network tiles and several sections
 * carry autoplaying video, neither of which paints deterministically in CI
 * — see `landing.spec.ts` for the functional assertions covering those.
 */
async function gotoWithTheme(page: Page, theme: Theme): Promise<void> {
  await pinTheme(page, theme);
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

test.describe(
  'marketing landing — hero visual regression',
  { tag: '@screenshot' },
  () => {
    for (const theme of THEMES) {
      test(`hero fold — ${theme}`, async ({ page }) => {
        await gotoWithTheme(page, theme);
        // Not pixel-for-pixel: video poster decode and font rasterization
        // differ between two runs even of the SAME app. The checklist's
        // cross-cutting target is ≤1% pixel delta on key pages (Goal 08
        // audits); the hero gate here uses the same envelope.
        await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`, {
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  },
);
