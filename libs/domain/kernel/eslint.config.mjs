import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The one place dinero.js/luxon/libphonenumber-js may be imported
    // directly (blueprint §0.3) — override the workspace-wide
    // no-restricted-imports rule to drop the dinero/luxon/libphonenumber
    // half, keeping the firebase half (kernel must never import Firebase
    // either). See the comment in the root eslint.config.mjs for why this
    // lives here instead of an `ignores` pattern on the shared rule.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'firebase',
                'firebase/*',
                'firebase-admin',
                'firebase-admin/*',
              ],
              message:
                'firebase/* and firebase-admin may only be imported from libs/infrastructure/** or apps/functions/** — go through a port instead.',
            },
          ],
        },
      ],
    },
  },
];
