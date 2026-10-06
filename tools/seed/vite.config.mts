/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tools/seed',
  // The specs check the seed's documents against the real mapper and the
  // real `computeClientStats`, imported by their aliases.
  plugins: [nxViteTsPaths()],
  test: {
    name: 'seed-tools',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.spec.mjs'],
    exclude: ['**/node_modules/**'],
    reporters: ['default'],
    // The loader spec bundles the functions' projection with esbuild.
    testTimeout: 30_000,
  },
}));
