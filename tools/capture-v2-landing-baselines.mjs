/**
 * Captures the landing hero from *running v2*, for a PARITY AUDIT — the only
 * legitimate source of v2 evidence per docs/migration/v2-parity-checklist.md
 * ("Visual-parity evidence rule"): captures self-taken from the Angular app
 * prove nothing about v2.
 *
 * Usage:
 *   1. cd ../v2 && npm run dev      (the landing renders its in-memory demo
 *      seed — Firebase emulators are NOT required for the marketing page)
 *   2. node tools/capture-v2-landing-baselines.mjs [v2Url] [outDir]
 *      default v2Url:  http://localhost:5173
 *      default outDir: dist/v2-parity/landing
 *
 * Writes landing-hero-{light,dark}-chromium-darwin.png into `outDir`, under
 * the same names, viewport (Desktop Chrome, 1280×720) and determinism setup
 * (bg locale, bw brand, reduced motion, video playback stubbed,
 * animations/backdrop-filter frozen) as landing-screenshots.spec.ts, so the
 * two can be laid side by side.
 *
 * NEVER into apps/web/e2e/landing-screenshots.spec.ts-snapshots/ — refused
 * below. Those were v2 captures while the hero was a v2 port; the hero left
 * v2 on purpose on 2026-07-22 (the landing case study's closing-CTA
 * register), and since 2026-09-25 they are the shipped hero's REGRESSION
 * baselines. A v2 capture written over them would fail the gate by design
 * and erase the regression evidence.
 */
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const v2Url = process.argv[2] ?? 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const snapshotsDir = resolve(
  process.argv[3] ?? join(here, '../dist/v2-parity/landing'),
);

// A Playwright snapshot folder holds a spec's baselines — for this hero,
// the shipped design's, which no v2 capture may stand in for.
if (basename(snapshotsDir).endsWith('.spec.ts-snapshots')) {
  console.error(
    `Refusing to write v2 captures into ${snapshotsDir}: that folder holds ` +
      'regression baselines of the shipped hero, not v2 evidence.',
  );
  process.exit(1);
}

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-play-state: paused !important;
    transition: none !important;
    backdrop-filter: none !important;
  }
`;

const browser = await chromium.launch();
await mkdir(snapshotsDir, { recursive: true });

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  // v2 persists appearance in `creativo-app` (zustand persist v1). The
  // migration is black-and-white only, so baselines use brand 'bw'; locale
  // bg mirrors the Angular app's default language.
  await page.addInitScript(
    ({ mode }) => {
      window.localStorage.setItem(
        'creativo-app',
        JSON.stringify({
          state: { locale: 'bg', mode, brand: 'bw' },
          version: 1,
        }),
      );
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    },
    { mode: theme },
  );

  await page.goto(v2Url, { waitUntil: 'load' });
  await page.waitForSelector('h1', { state: 'visible', timeout: 30_000 });
  // Give the hero poster/fonts a beat to settle, then freeze everything.
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForTimeout(1_500);

  const file = join(snapshotsDir, `landing-hero-${theme}-chromium-darwin.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
  await context.close();
}

await browser.close();
console.log(
  `Done — v2's hero is in ${snapshotsDir}. Compare it with the shipped ` +
    'baselines in apps/web/e2e/landing-screenshots.spec.ts-snapshots/.',
);
