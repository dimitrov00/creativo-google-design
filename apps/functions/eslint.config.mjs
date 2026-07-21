import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // One of the two places firebase-admin may be imported directly
    // (blueprint §0.3/§1.2) — override the workspace-wide
    // no-restricted-imports rule to drop the firebase half, keeping the
    // dinero/luxon/libphonenumber half (Cloud Functions still go through
    // Money/ZonedDateTime/PhoneNumber, not the raw libs). See the comment
    // in the root eslint.config.mjs for why this lives here instead of an
    // `ignores` pattern on the shared rule.
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
