/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tools/flags',
  // The parity spec imports the domain's flag vocabulary by its alias.
  plugins: [nxViteTsPaths()],
  test: {
    name: 'flag-tools',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.spec.mjs'],
    exclude: ['**/node_modules/**'],
    reporters: ['default'],
  },
}));
