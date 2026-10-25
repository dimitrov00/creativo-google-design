import nx from '@nx/eslint-plugin';
import baseConfig, {
  ECS_ALL_SUFFIXES,
  ECS_ID_CAST_RESTRICTIONS,
  PRODUCTION_TS_IGNORES,
  UI_RAW_PRIMITIVE_RESTRICTIONS,
} from '#eslint-config';

/** An ECS-suffix file here keeps the root's suffix block, icon selectors included. */
const ECS_SUFFIX_FILES = ECS_ALL_SUFFIXES.map((suffix) => `**/*.${suffix}.ts`);

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
    //
    // Only the icon-syntax selectors are lifted (`no-restricted-syntax`
    // options replace, never merge, so the block restates what stays): L7 —
    // no cast to `UserId`/`CustomerId` — holds on every file, specs
    // included, as it does everywhere else in the workspace.
    files: ['**/*.ts'],
    ignores: ECS_SUFFIX_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...ECS_ID_CAST_RESTRICTIONS],
    },
  },
  {
    // ...and the production files keep the features/UI raw-brand guard
    // (Law 7.4, pass D D-13.1 — the root's `uiRawPrimitiveBlock`, whose
    // icon-syntax half the registry lifts; pass E, E-5). Specs and test
    // support keep the block above, as they keep the every-file blocks at
    // the root.
    files: ['**/*.ts'],
    ignores: [...ECS_SUFFIX_FILES, ...PRODUCTION_TS_IGNORES],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ECS_ID_CAST_RESTRICTIONS,
        ...UI_RAW_PRIMITIVE_RESTRICTIONS,
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      'creativo/icon-registry-only': 'off',
    },
  },
];
