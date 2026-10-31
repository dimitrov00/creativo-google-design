import nx from '@nx/eslint-plugin';
import baseConfig from '#eslint-config';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Dev tooling over repo files and hosts it names itself (the dev seed,
    // the dev host, the landing-baseline capture): paths and lookup keys are
    // computed by design, never user input (as in tools/seed, tools/flags).
    files: ['**/*.mjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Each nested project lints itself, under its own config.
    ignores: [
      'seed/**',
      'lint-rules/**',
      'icons/**',
      'verify/**',
      'flags/**',
      'ops/**',
    ],
  },
];
