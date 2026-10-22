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
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'cr',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'cr',
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
    // One of the places firebase/* may be imported directly (blueprint
    // §0.3/§1.2) — override the workspace-wide no-restricted-imports rule
    // to drop the firebase half, keeping the dinero/luxon/libphonenumber
    // half (infrastructure goes through the `Money` struct, `ZonedTimeSystem`
    // and `PhoneSystem` of ecs-core, never the raw libs). See the comment in
    // the root eslint.config.mjs for why this lives here instead of an
    // `ignores` pattern on the shared rule.
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
