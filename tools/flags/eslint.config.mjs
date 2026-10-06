import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Build tooling over repo files it names itself: paths and manifest keys
    // are computed by design, never user input (as in tools/icons).
    files: ['**/*.mjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
];
