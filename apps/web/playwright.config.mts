import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

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
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm nx run web:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: false,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
