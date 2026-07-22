import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

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
    // One of the places firebase/* may be imported directly (blueprint
    // §0.3/§1.2) — override the workspace-wide no-restricted-imports rule
    // to drop the firebase half, keeping the dinero/luxon/libphonenumber
    // half (infrastructure still goes through Money/ZonedDateTime/
    // PhoneNumber, not the raw libs). See the comment in the root
    // eslint.config.mjs for why this lives here instead of an `ignores`
    // pattern on the shared rule.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dinero.js',
              message:
                'dinero.js may only be imported from libs/domain/kernel/** — use Money instead.',
            },
            {
              name: 'luxon',
              message:
                'luxon may only be imported from libs/domain/kernel/** — use ZonedDateTime instead.',
            },
            {
              name: 'libphonenumber-js',
              message:
                'libphonenumber-js may only be imported from libs/domain/kernel/** — use PhoneNumber instead.',
            },
          ],
        },
      ],
    },
  },
];
