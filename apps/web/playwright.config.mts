import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

/**
 * The client-details specs (design §12.4 P0, §12.6.8-10). They run once per
 * viewport project below and never under `chromium`, so every screenshot they
 * take is named `{surface}-{state}-{theme}` plus the project suffix
 * (`-phone-darwin`, …) while today's `-chromium-darwin` baselines keep theirs.
 * `client-page*` covers the P1 inventory's `client-page.spec.ts` and
 * `client-page-screenshots.spec.ts` (§12.6.14).
 */
const CLIENT_DETAILS_SPECS = [
  '**/client-card-*.spec.ts',
  '**/client-route-*.spec.ts',
  '**/client-page*.spec.ts',
];

/** The 390 × 844 phone the client page is designed above the fold for (§4.5). */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };

/**
 * App-shell smoke suite (blueprint §8 Phase 5 exit gate) — run against
 * Firebase emulators via `pnpm run e2e:web` (wraps `firebase
 * emulators:exec`, mirroring the root `test:emulator` script). Uses the
 * plain dev server (not a production build) so `environment.ts`'s
 * `emulators.enabled: true` default applies and `E2eTestHooksService`'s
 * `window.__e2eSignIn` hook is present (a no-op once `environment.production`
 * is true).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './e2e' }),
  // The dev catalogue, once per run (not once per worker) — see the file.
  globalSetup: './e2e/support/global-setup.ts',
  // NO retries locally (CI keeps the preset's two): a flake is a bug to
  // find, not a pass to retry. The emulators are the workspace's pinned
  // firebase-tools (root devDependency, started through the package
  // scripts; the global setup refuses a hub that is not), so a failure here
  // is ours to read, not the CLI's.
  retries: process.env['CI'] ? 2 : 0,
  // The screenshot baselines are macOS renders (`*-chromium-darwin.png`),
  // so the owner's macOS full gate is the screenshot gate. CI's e2e job
  // alone sets the switch below to `skip` and runs everything else; the
  // switch is closed — any other value, or none, runs every test, the
  // `@screenshot`-tagged describes included (P3-RU-30).
  grepInvert:
    process.env['CREATIVO_E2E_SCREENSHOTS'] === 'skip'
      ? /@screenshot/
      : undefined,
  use: {
    baseURL,
    // Every attempt records; a FAILED attempt keeps its trace, and so does
    // every retry (on CI). `on-first-retry` traced only the retry, which
    // passes on a flake: round 4's one-in-144 `/account` stall left no trace
    // of the attempt that stalled, so it could never be read (2026-09-26).
    trace: 'retain-on-failure-and-retries',
    // The device's zone is the shop's, whatever the host's: a client's
    // phone in Sofia is the common case, and a baseline must not depend on
    // where the suite runs. Specs that prove shop-time formatting move the
    // device far away instead (`test.use({ timezoneId })`).
    timezoneId: 'Europe/Sofia',
  },
  webServer: {
    command: 'pnpm nx run web:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: false,
    cwd: workspaceRoot,
  },
  // Every project renders with Chromium: single-engine baselines, as the
  // showcase suite keeps them. The touch projects still emulate a touch
  // device (`isMobile` + `hasTouch`), so `(hover: none)` and the ungated
  // `:active` press paths are what a phone or tablet run exercises.
  projects: [
    {
      name: 'chromium',
      // The CSP smoke runs on its own config against the Hosting emulator
      // (`playwright.csp.config.mts`, `pnpm run verify:csp` — OR-31).
      testIgnore: [...CLIENT_DETAILS_SPECS, '**/csp/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phone',
      testMatch: CLIENT_DETAILS_SPECS,
      use: {
        ...devices['Pixel 7'],
        viewport: PHONE,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'tablet',
      testMatch: CLIENT_DETAILS_SPECS,
      use: {
        ...devices['Galaxy Tab S4'],
        viewport: TABLET,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'desktop',
      testMatch: CLIENT_DETAILS_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
