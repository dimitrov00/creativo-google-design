/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

/**
 * Emulator-backed integration suite. Adapters are constructed via
 * `TestBed.inject(...)` (they resolve their Firebase SDK handle through
 * `inject(FIREBASE_FIRESTORE)`, same as production DI), so this needs the
 * same Angular TestBed bootstrap as the plain `test` target — jsdom +
 * `src/test-setup.ts`. What makes this suite "integration" is the Firestore
 * Emulator on the other end (localhost:8080), not the test runtime itself.
 * Requires the Firestore Emulator running (`firebase emulators:exec`, see
 * the root `test:emulator` script) — run via the `test-integration` Nx
 * target, never the plain `test` target, so `nx run-many -t test` stays
 * emulator-free.
 */
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/infrastructure/firestore-integration',
  plugins: [angular(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'firestore-integration',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.integration.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/infrastructure/firestore-integration',
      provider: 'v8' as const,
    },
  },
}));
