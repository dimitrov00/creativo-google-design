import nx from '@nx/eslint-plugin';
import baseConfig from '#eslint-config';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Tooling that reads source files by computed path and builds regexes
    // from selector names takes computed input by design.
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
