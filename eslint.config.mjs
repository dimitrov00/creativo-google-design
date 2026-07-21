import nx from '@nx/eslint-plugin';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/libs/shared/design-tokens/generated/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // See docs/architecture/module-boundaries.md for the full tag matrix
      // and the reasoning behind each rule.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Scope isolation: a project can only depend on its own scope
            // plus scope:shared. `domain`/`application`/`infrastructure`/`ui`
            // libs are all scope:shared (blueprint §1.2) — the frontend
            // product-surface scopes below (marketing/client/staff/admin)
            // are for `type:feature` libs only.
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:showcase',
              onlyDependOnLibsWithTags: ['scope:showcase', 'scope:shared'],
            },
            {
              sourceTag: 'scope:marketing',
              onlyDependOnLibsWithTags: ['scope:marketing', 'scope:shared'],
            },
            {
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:client', 'scope:shared'],
            },
            {
              sourceTag: 'scope:staff',
              onlyDependOnLibsWithTags: ['scope:staff', 'scope:shared'],
            },
            {
              sourceTag: 'scope:admin',
              onlyDependOnLibsWithTags: ['scope:admin', 'scope:shared'],
            },
            // scope:backend (Cloud Functions) doesn't fit any of the
            // frontend-app-shaped scopes above — see the "Amendments" note
            // in docs/architecture/module-boundaries.md for why this isn't
            // just scope:shared.
            {
              sourceTag: 'scope:backend',
              onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'],
            },
            // scope:web is the single consolidated SPA shell (apps/web) —
            // it composes every product surface, so unlike the scopes above
            // it may depend on all of them plus itself and scope:shared.
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: [
                'scope:web',
                'scope:marketing',
                'scope:client',
                'scope:staff',
                'scope:admin',
                'scope:shared',
              ],
            },
            // Layering (blueprint §1.2): keeps the hexagon's arrows one-way —
            // ui never sees application/infrastructure, application never
            // sees Angular templates or Firebase, infrastructure is the only
            // place firebase/* resolves (enforced below via
            // no-restricted-imports), domain only ever depends on domain.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:application',
                'type:ui',
                'type:infrastructure',
                'type:domain',
                'type:util',
                'type:tokens',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:application',
                'type:ui',
                'type:infrastructure',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:application',
              onlyDependOnLibsWithTags: [
                'type:application',
                'type:domain',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:tokens', 'type:util'],
            },
            {
              sourceTag: 'type:infrastructure',
              onlyDependOnLibsWithTags: [
                'type:application',
                'type:domain',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util', 'type:tokens'],
            },
            {
              sourceTag: 'type:tokens',
              onlyDependOnLibsWithTags: ['type:tokens'],
            },
          ],
        },
      ],
    },
  },
  // Firebase/dinero/luxon/libphonenumber restrictions (blueprint §0.3/§1.2).
  // Nx runs each project's `lint` target with `cwd` set to that project's
  // own directory (`eslint .`), so ESLint's basePath is the PROJECT root,
  // not the workspace root — a repo-root-relative `ignores` pattern like
  // `**/libs/domain/kernel/**` can never match once basePath already IS
  // `libs/domain/kernel` (the prefix is stripped away). So these rules are
  // unconditional here, and the two exempt zones (`libs/domain/kernel` for
  // dinero/luxon/libphonenumber; `libs/infrastructure/*` + `apps/functions`
  // for firebase) turn the relevant half off in their OWN eslint.config.mjs
  // instead — see the `rules: { 'no-restricted-imports': 'off' }` overrides
  // in kernel/eslint.config.mjs, apps/functions/eslint.config.mjs, and each
  // libs/infrastructure/*/eslint.config.mjs.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'firebase',
                'firebase/*',
                'firebase-admin',
                'firebase-admin/*',
              ],
              message:
                'firebase/* and firebase-admin may only be imported from libs/infrastructure/** or apps/functions/** — go through a port instead.',
            },
          ],
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
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.mjs',
      '**/*.cjs',
    ],
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      ...security.configs.recommended.rules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
