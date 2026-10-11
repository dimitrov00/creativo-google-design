import nx from '@nx/eslint-plugin';
import baseConfig from '#eslint-config';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Dev-seed tooling over fixtures it names itself: lookups by fixed keys
    // and a bundle it writes into its own cache directory, never user input.
    files: ['**/*.mjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
];
