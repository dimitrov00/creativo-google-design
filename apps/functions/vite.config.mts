/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/functions',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'functions',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    // Emulator-backed suites run under the separate `test-integration`
    // target (`vitest.integration.config.mts`) so `nx run-many -t test`
    // stays emulator-free.
    exclude: ['**/*.integration.spec.ts', '**/node_modules/**'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/functions',
      provider: 'v8' as const,
    },
  },
}));
