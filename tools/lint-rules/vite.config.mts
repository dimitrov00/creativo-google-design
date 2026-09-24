/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/tools/lint-rules',
  test: {
    name: 'lint-rules',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['**/*.spec.mjs'],
    exclude: ['**/node_modules/**'],
    reporters: ['default'],
  },
}));
