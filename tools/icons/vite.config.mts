/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tools/icons',
  test: {
    name: 'icon-tools',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.spec.mjs'],
    exclude: ['**/node_modules/**', '**/__fixtures__/**'],
    reporters: ['default'],
  },
}));
