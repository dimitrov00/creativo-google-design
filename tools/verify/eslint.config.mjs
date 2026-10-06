import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/javascript'],
  ...baseConfig,
  {
    // Verification runners over files they name themselves (a build's
    // stats.json, the seed's documents): paths and keys are computed by
    // design, never user input (as in tools/seed and tools/flags).
    files: ['**/*.mjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
];
