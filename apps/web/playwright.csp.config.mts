import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';

/**
 * Where the Hosting emulator serves the `csp-smoke` build — `firebase.json`'s
 * `emulators.hosting.port`, on 127.0.0.1: the dev environment points the
 * SDKs at the emulators on the page's own host, and the generated CSP admits
 * exactly the 127.0.0.1 emulator origins (`tools/verify/csp/emulator-config.mjs`).
 */
const baseURL = process.env['CSP_BASE_URL'] || 'http://127.0.0.1:5050';

/**
 * THE CSP SMOKE (owner rulings OR-30, OR-31) — the real artifact behind the
 * real headers: the `web:build:csp-smoke` build (production, minus the
 * environment replacement and the service worker) served by the Hosting
 * emulator on a generated config that differs from `firebase.json` only by
 * the emulator origins. Run as `pnpm run verify:csp`, which builds both,
 * writes that config and starts every emulator; never against the dev
 * server, whose responses carry no policy at all.
 *
 * Its own config, so the e2e suite's projects never run it and it never
 * runs theirs: the smoke lives in `e2e/csp/`, and this file's `testDir`
 * names that folder alone. The dev catalogue is seeded once, as the e2e
 * suite seeds it (`globalSetup`).
 */
const preset = nxE2EPreset(import.meta.dirname, {
  testDir: './e2e/csp',
  // A gate: a failing run prints and exits, never parks on a report server.
  openHtmlReport: 'never',
});

// The smoke's own marker: `e2e/csp/csp-smoke.spec.ts` runs only when this
// file loaded it (every worker loads the config again, so the marker
// reaches them too) and skips itself under the e2e suite's config, whose
// `./e2e` folder holds it as well.
process.env['CREATIVO_CSP_SMOKE'] = '1';

export default defineConfig({
  ...preset,
  // A line per test on the terminal, beside the preset's HTML report.
  reporter: [
    ['list'],
    ...(Array.isArray(preset.reporter) ? preset.reporter : []),
  ],
  globalSetup: './e2e/support/global-setup.ts',
  // No retries anywhere: a violation that shows up one run in three is a
  // violation.
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The shop's zone, as in the e2e suite.
    timezoneId: 'Europe/Sofia',
  },
  // Chromium on both, as the e2e suite renders: a desktop and a phone (the
  // Pixel 7 emulates touch, so the phone paths are the ones exercised).
  projects: [
    { name: 'csp-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'csp-pixel-7', use: { ...devices['Pixel 7'] } },
  ],
});
