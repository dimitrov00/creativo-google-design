/**
 * Captures the landing visual-parity BASELINES from *running v2* — the only
 * legitimate source per docs/migration/v2-parity-checklist.md ("Visual-parity
 * evidence rule"): baselines self-captured from the Angular app prove nothing.
 *
 * Usage:
 *   1. cd ../v2 && npm run dev      (the landing renders its in-memory demo
 *      seed — Firebase emulators are NOT required for the marketing page)
 *   2. node tools/capture-v2-landing-baselines.mjs [v2Url]
 *      default v2Url: http://localhost:5173
 *
 * Writes landing-hero-{light,dark}-chromium-darwin.png into
 * apps/web/e2e/landing-screenshots.spec.ts-snapshots/, matching
 * landing-screenshots.spec.ts's snapshot names, viewport (Desktop Chrome,
 * 1280×720) and determinism setup (bg locale, bw brand, reduced motion,
 * video playback stubbed, animations/backdrop-filter frozen).
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const v2Url = process.argv[2] ?? 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const snapshotsDir = join(
  here,
  '../apps/web/e2e/landing-screenshots.spec.ts-snapshots',
);

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
console.log('Done — baselines now come from v2. Re-run the Angular spec with:');
console.log('  pnpm nx e2e web --grep "hero screenshot"');
