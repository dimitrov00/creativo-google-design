/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/ui-index',
  test: {
    name: 'ui-index-tools',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.spec.mjs'],
    exclude: ['**/node_modules/**'],
    reporters: ['default'],
  },
}));
