import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Deliberately-dirty inputs for the checker's tests — not code.
    ignores: ['__fixtures__/**'],
  },
  {
    // Tooling that scans for the banned patterns has to spell them; its
    // regexes and fs calls take computed input by design.
    files: ['**/*.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
];
