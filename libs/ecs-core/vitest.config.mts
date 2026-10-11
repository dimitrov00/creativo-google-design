import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/ecs-core',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'ecs-core',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/ecs-core',
      provider: 'v8' as const,
      // Vitest 4 counts only the files a spec loads unless `include` names
      // them, so an untested companion would vanish from the percentage
      // instead of lowering it (blueprint §6 Phase 1 gate). The tier barrels
      // (Law 8), the test support and the ports carry no statements worth
      // counting. The entity files stay IN: the type-only ones compile to no
      // statements (so they count for nothing either way), while the id companions
      // (`XId.of`, the `FIXED` ids, `BackfillJobKind`, `Profile`) are runtime
      // code an untested edit must lower the figure for.
      include: ['src/**/*.ts'],
      exclude: [
        'src/*/index.ts',
        'src/testing/**',
        'src/ports/**',
        '**/*.spec.ts',
        '**/*.type-spec.ts',
      ],
      // Glob keys resolve against `root` (this project); the global
      // `statements` still counts every file, globbed ones included.
      thresholds: {
        statements: 90,
        'src/components/**': { statements: 90 },
        'src/systems/**': { statements: 95 },
      },
    },
  },
}));
