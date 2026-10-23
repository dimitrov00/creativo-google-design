import nx from '@nx/eslint-plugin';
import baseConfig, {
  LAYER_IMPORT_RESTRICTIONS,
  TESTING_ENTRY_POINT_RESTRICTION,
} from '#eslint-config';

/**
 * This project's import restrictions: the root layer rule
 * (`LAYER_IMPORT_RESTRICTIONS`, the ONE home of its messages) minus the
 * firebase half this project is allowed — shared by its production rule and
 * its spec rule.
 */
const IMPORT_RESTRICTIONS = {
  ...LAYER_IMPORT_RESTRICTIONS,
  patterns: LAYER_IMPORT_RESTRICTIONS.patterns.filter(
    (pattern) => !pattern.group.includes('firebase'),
  ),
};

/**
 * Production code also may not import a testing entry point of a @creativo lib
 * (test support); a rule's options replace, never merge, so the root
 * config's testing half is restated here, and the spec block below drops it.
 */
function withTestingRestriction(restrictions) {
  return {
    ...restrictions,
    patterns: [
      ...(restrictions.patterns ?? []),
      TESTING_ENTRY_POINT_RESTRICTION,
    ],
  };
}

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
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
  {
    // One of the projects that may import firebase/* directly
    // (docs/architecture/module-boundaries.md "Import cages") — override the
    // workspace-wide no-restricted-imports rule to drop ONLY the firebase
    // half, keeping the libphonenumber cage (infrastructure goes through
    // ecs-core's `PhoneSystem`, never the raw lib) and the retired
    // luxon/dinero.js bans. See the comment in the root eslint.config.mjs for
    // why this lives here instead of an `ignores` pattern on the shared rule.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        withTestingRestriction(IMPORT_RESTRICTIONS),
      ],
    },
  },
  {
    // Specs are what the testing entry points are for.
    files: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', IMPORT_RESTRICTIONS],
    },
  },
];
