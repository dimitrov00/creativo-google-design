import nx from '@nx/eslint-plugin';
import baseConfig from '#eslint-config';

/**
 * The specs' own import rule, read from the root config rather than
 * restated: the layer restrictions without the half that keeps the
 * `@creativo/<lib>/testing` and `@core/testing` entry points to specs (the
 * root keeps the two apart for exactly this, see its
 * `TESTING_ENTRY_POINT_RESTRICTION`).
 */
const specImports = baseConfig.find(
  (block) =>
    block.files?.includes('**/*.spec.ts') &&
    block.rules?.['no-restricted-imports'] !== undefined,
)?.rules['no-restricted-imports'];
if (specImports === undefined) {
  throw new Error(
    "The root eslint config no longer states the specs' import rule.",
  );
}

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    // `src/lib/testing/**` is the specs' shared support — fixtures built
    // from `@core/testing` — outside the lib's build (tsconfig.lib.json
    // excludes it, src/index.ts never exports it), imported by specs only.
    files: ['**/src/lib/testing/**/*.ts'],
    rules: {
      'no-restricted-imports': specImports,
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'lib',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'lib',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
