/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

/**
 * Emulator-backed integration suite for the FUNCTIONS side — Admin SDK
 * against the Firestore Emulator, plain node runtime.
 *
 * This lane exists for the hazards no in-memory fake can honestly carry:
 * Firestore's merge-vs-replace semantics, transactions, FieldPath updates.
 * The rollup's critical review finding (leaf-level merge keeping vanished
 * location keys alive) would have passed green against any fake that merged
 * the way its author assumed — which is precisely why the fake was not
 * taught to try. Run via the `test-integration` Nx target with the emulator
 * up (`pnpm run dev`, or `firebase emulators:exec --only firestore`); the
 * specs refuse to run without `FIRESTORE_EMULATOR_HOST`, same guard as the
 * seed.
 */
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/functions-integration',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'functions-integration',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/functions-integration',
      provider: 'v8' as const,
    },
  },
}));
