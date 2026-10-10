import nx from '@nx/eslint-plugin';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import templateParser from '@angular-eslint/template-parser';
import creativo, {
  ECS_ROOT_SUFFIXES,
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
  ecsSyntaxBlocks,
} from './tools/lint-rules/index.mjs';

/**
 * The layer half of `no-restricted-imports` (blueprint §0.3/§1.2): Firebase
 * only in infrastructure and the functions; libphonenumber only inside
 * `PhoneSystem` (libs/ecs-core/src/systems/phone.system.ts); luxon and
 * dinero.js nowhere new — owner decisions D5/D4 (2026-10-10) replace them
 * with native `Intl` in `ZonedTimeSystem` and the plain `Money` struct, and
 * the legacy kernel keeps its exemption only until Phase 4 deletes it.
 * Named and exported so the spec override below, and the projects that
 * exempt one package for one file (libs/ecs-core), restate it exactly.
 */
export const LAYER_IMPORT_RESTRICTIONS = {
  patterns: [
    {
      group: ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*'],
      message:
        'firebase/* and firebase-admin may only be imported from libs/infrastructure/** or apps/functions/** — go through a port instead.',
    },
    {
      group: ['libphonenumber-js', 'libphonenumber-js/*'],
      message:
        'libphonenumber-js may only be imported from libs/ecs-core/src/systems/phone.system.ts (and the legacy libs/domain/kernel/** until Phase 4) — use PhoneSystem and the PhoneNumber component instead.',
    },
  ],
  paths: [
    {
      name: 'dinero.js',
      message:
        'dinero.js is retired (D4): money is the plain { amountMinorUnits, currencyCode } struct — use Money from libs/ecs-core/src/components/money.data.ts (only the legacy libs/domain/kernel/** keeps dinero, until Phase 4).',
    },
    {
      name: 'luxon',
      message:
        'luxon is retired (D5): zone math is native Intl inside libs/ecs-core/src/systems/zoned-time.system.ts — use ZonedTimeSystem and ZonedInstant (only the legacy libs/domain/kernel/** keeps luxon, until Phase 4).',
    },
  ],
};

/**
 * `@creativo/<lib>/testing` entry points hold TEST SUPPORT — a port's
 * executable contract, its in-memory reference adapter, fixtures — kept off
 * the production barrels so a provider can never be handed one
 * (`libs/application/booking/src/testing.ts`). Specs import them; nothing
 * else may. Exported for the projects that restate `no-restricted-imports`
 * for their own exempt zone (apps/functions, libs/infrastructure/*,
 * libs/domain/kernel): a restated rule drops this half unless it lists it.
 */
export const TESTING_ENTRY_POINT_RESTRICTION = {
  group: ['@creativo/**/testing'],
  message:
    '@creativo/**/testing entry points are test support (contracts, in-memory adapters, fixtures) — import them from specs (*.spec.ts) only, never from production code.',
};

/**
 * The ECS lint pieces the project-scoped configs (libs/ecs-core,
 * apps/functions) restate, re-exported from HERE on purpose: this file
 * belongs to no Nx project, but a project config importing
 * tools/lint-rules directly gives that project a graph edge to
 * `lint-rules` — and the functions build then writes eslint's parsers into
 * its generated package.json (caught by tools/verify/p0/functions-deps.mjs).
 */
export {
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
  ecsProjectBlocks,
} from './tools/lint-rules/index.mjs';

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
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            // The build-time flag manifest (R41, §12.1) sits outside every
            // project on purpose: the web's environment files import their
            // map from it, and tools/flags writes the functions params from
            // the same file.
            '^(\\.\\./)+config/feature-flags\\.json$',
          ],
          depConstraints: [
            // Scope isolation: a project can only depend on its own scope
            // plus scope:shared. `domain`/`application`/`infrastructure`/`ui`
            // libs are all scope:shared (blueprint §1.2); every `type:feature`
            // lib is `scope:app`.
            //
            // `scope:app` replaced the four product-surface scopes
            // (marketing/client/staff/admin) on 2026-07-28 — owner ruling:
            // this is ONE app, and the split was legacy structure whose only
            // practical effect was blocking legitimate edges (the shell's
            // account chrome reading the client session model). Cross-surface
            // isolation was never the boundary that mattered here; the
            // LAYERING rules below — which keep domain/application/ui from
            // ever seeing a feature — are, and they are untouched.
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:showcase',
              onlyDependOnLibsWithTags: ['scope:showcase', 'scope:shared'],
            },
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: ['scope:app', 'scope:shared'],
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
            // it composes the feature libs, so unlike scope:shared it may
            // depend on scope:app as well as itself.
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: [
                'scope:web',
                'scope:app',
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
              // `type:domain` added 2026-10-10 (ECS migration D10(a)): a
              // feature reads the plain ECS data and calls the pure systems
              // of `@creativo/ecs-core` (tagged `type:domain`) straight from
              // its stores and `computed()`s — there is no view-model layer
              // in between (.claude/rules/angular-ui.md).
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:application',
                'type:ui',
                'type:infrastructure',
                'type:domain',
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
              // `type:domain` added 2026-07-25 (auth-flow design, slice
              // "UiPhoneField"): DS composites may consume the PURE domain
              // kernel (Result/value objects/branded types, zero Angular,
              // zero IO — and the caged libphonenumber wrapper UiPhoneField
              // needs for as-you-type formatting). The hexagon's critical
              // arrow is unchanged: ui still never sees `application` or
              // `infrastructure` — see docs/architecture/module-boundaries.md.
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: [
                'type:ui',
                'type:tokens',
                'type:util',
                'type:domain',
              ],
            },
            {
              // `type:infrastructure` may also depend on itself (added
              // Goal 04): every Firebase-backed adapter lib (`firestore`,
              // `firebase-auth`, `storage`) injects the `FIREBASE_*` SDK
              // singleton tokens from `infrastructure/firebase-app`
              // (blueprint §1.3's composition-root wiring — `useClass`
              // providers resolve those tokens from inside the adapter
              // class itself, not just at `app.config.ts`) — this is the
              // one legitimate infra→infra edge, not a general license for
              // one adapter concern to reach into an unrelated one.
              sourceTag: 'type:infrastructure',
              onlyDependOnLibsWithTags: [
                'type:infrastructure',
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
  // Firebase/dinero/luxon/libphonenumber restrictions (blueprint §0.3/§1.2),
  // plus the testing entry points outside specs (round 6, 2026-09-26).
  // Nx runs each project's `lint` target with `cwd` set to that project's
  // own directory (`eslint .`), so ESLint's basePath is the PROJECT root,
  // not the workspace root — a repo-root-relative `ignores` pattern like
  // `**/libs/domain/kernel/**` can never match once basePath already IS
  // `libs/domain/kernel` (the prefix is stripped away). So these rules are
  // unconditional here, and the exempt zones (`libs/domain/kernel` for
  // dinero/luxon/libphonenumber until Phase 4; libs/ecs-core's
  // `src/systems/phone.system.ts` for libphonenumber and its spec-only
  // `src/components/money.data.spec.ts` for dinero; `libs/infrastructure/*`
  // + `apps/functions` for firebase) turn the relevant half off in their OWN
  // eslint.config.mjs instead — see the `no-restricted-imports` overrides
  // in kernel/eslint.config.mjs, ecs-core/eslint.config.mjs,
  // apps/functions/eslint.config.mjs, and each
  // libs/infrastructure/*/eslint.config.mjs. The one exempt zone that is NOT
  // a project — Playwright's Node-side tooling under `apps/*/e2e/` — has no
  // config of its own and is linted under three different basePaths (the
  // nx executor's workspace root, a direct `eslint apps/web/e2e` from the
  // root, `eslint e2e` from the app), so its exemption lives here, as a
  // basePath-independent pattern, right after the two rule blocks below.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...LAYER_IMPORT_RESTRICTIONS.patterns,
            TESTING_ENTRY_POINT_RESTRICTION,
          ],
          paths: LAYER_IMPORT_RESTRICTIONS.paths,
        },
      ],
    },
  },
  {
    // Specs are what the testing entry points are FOR. A rule's options are
    // replaced, never merged, by a later block, so this restates the layer
    // half without the testing one.
    files: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', LAYER_IMPORT_RESTRICTIONS],
    },
  },
  {
    // Playwright e2e tooling (apps/web/e2e/support) mints Firebase Admin
    // custom tokens and seeds the emulators directly, and its fixtures come
    // from the `@creativo/**/testing` entry points — it is test support that
    // never ships in an app bundle, so neither half of the boundary applies
    // (blueprint §1.2). `**/e2e/**` on purpose, not `apps/web/e2e/**`: a
    // `files` pattern is resolved against ESLint's basePath, and this folder
    // is linted under three of them (see the note above).
    files: ['**/e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
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
  // ── Icons go through the registry (libs/ui/icons) ──────────────────
  // Three guards, each catching what the others cannot:
  //  1. `no-restricted-syntax` (TypeScript): icon-font / Angular Material
  //     imports, `as UiIconName` casts, Material class or font names in
  //     string literals — the holes the closed `UiIconName` union cannot see.
  //  2. `creativo/icon-registry-only` (templates, inline ones included via
  //     the angular-template processor): <mat-icon>, raw ligature spans, raw
  //     glyph names in `uiName`/`uiIcon`, <img> logos.
  //  3. `pnpm icons:check` in CI: the repo-wide sweep behind both.
  // The allow-list is the registry's own project — libs/ui/icons turns the
  // relevant halves off in its eslint.config.mjs. Selectors live in
  // tools/lint-rules/icon-syntax.mjs and are tested there.
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...ICON_SYNTAX_RESTRICTIONS],
    },
  },
  {
    // Specs may cast to UiIconName to exercise the runtime fallback.
    files: ['**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...ICON_SPEC_SYNTAX_RESTRICTIONS],
    },
  },
  // ── ECS file kinds (CLAUDE.md §1–2, blueprint §6 Phase 1) ─────────────
  // One `files:` block per suffix — AST selectors cannot see file names, so
  // spreading the ECS selectors into the `**/*.ts` block above would fire
  // `Date.now`, the import bans and the optional-property ban across the
  // whole repo. Each block restates `[...ICON_SYNTAX_RESTRICTIONS,
  // ...ECS_<SUFFIX>_RESTRICTIONS]` because options replace, never merge;
  // systems also get `no-restricted-globals`, data and entities turn
  // `@typescript-eslint/no-namespace` off for their one type-only
  // namespace, systems and data turn `security/detect-object-injection`
  // off. Only the four suffixes no legacy file carries live here: the
  // `*.port.ts`/`*.adapter.ts` blocks and the `InjectionToken` guard would
  // hit libs/application's 44 port files and the 40 class adapters, so in
  // Phase 1 they sit in libs/ecs-core's and apps/functions' own configs and
  // move here in Phase 4 with the legacy files. Selectors live in
  // tools/lint-rules/ecs-syntax.mjs and are tested there.
  ...ecsSyntaxBlocks(ECS_ROOT_SUFFIXES),
  {
    files: ['**/*.html'],
    plugins: { creativo },
    languageOptions: { parser: templateParser },
    rules: {
      'creativo/icon-registry-only': [
        'error',
        {
          // The ONLY hand-drawn <svg>s outside libs/ui/icons, each a shape
          // rather than a glyph: a progress ring, the toast's countdown ring,
          // the reward moment's draw-on stroke whose geometry IS the
          // animation, and the gauge's circular style (the arc round a medal
          // or a face). A new entry here is a design decision, not a shortcut.
          allowInlineSvg: [
            'libs/ui/controls/src/lib/progress-ring/progress-ring.ts',
            'libs/ui/patterns/src/lib/toast/toast.ts',
            'libs/ui/patterns/src/lib/reward-moment/reward-moment.ts',
            'libs/ui/patterns/src/lib/gauge/gauge.ts',
          ],
        },
      ],
      // `uiLabel` IS an accessible name: every DS control that takes it binds
      // the host's `aria-label` (a medal or a quick action draws a glyph, not
      // words). The rule merges this with its own safelist.
      '@angular-eslint/template/elements-content': [
        'error',
        { allowList: ['uiLabel'] },
      ],
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
