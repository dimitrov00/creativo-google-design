import nx from '@nx/eslint-plugin';
import baseConfig from '#eslint-config';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Release tooling over repo files it names itself (package.json, the
    // release-please config): paths and keys are computed by design, never
    // user input (as in tools/verify and tools/flags).
    files: ['**/*.mjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
];
