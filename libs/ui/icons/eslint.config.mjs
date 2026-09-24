import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ui', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        [
          { type: 'element', prefix: 'ui', style: 'kebab-case' },
          { type: 'attribute', prefix: 'ui', style: 'camelCase' },
        ],
      ],
    },
  },
  {
    // THE REGISTRY BOUNDARY — the allow-list of the workspace icon guards.
    // This project is where glyph names, Material provenance strings and
    // vector data legitimately live; everything outside it goes through
    // ui-icon / ui-logo / UiIconRegistry. Nothing here imports an icon
    // font either: the artwork is the generated path table.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      'creativo/icon-registry-only': 'off',
    },
  },
];
