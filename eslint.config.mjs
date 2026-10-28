import nx from '@nx/eslint-plugin';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import templateParser from '@angular-eslint/template-parser';
import creativo, {
  ECS_ALL_SUFFIXES,
  ECS_TOKEN_RESTRICTIONS,
  ecsRootEveryFileBlocks,
  ecsSyntaxBlocks,
  uiRawPrimitiveBlock,
} from './tools/lint-rules/index.mjs';

/**
 * The layer half of `no-restricted-imports` (docs/architecture/module-boundaries.md,
 * "Import cages"): Firebase only in infrastructure and the functions;
 * libphonenumber only inside `PhoneSystem`
 * (libs/ecs-core/src/systems/phone.system.ts); luxon and dinero.js nowhere —
 * owner decisions D5/D4 (2026-10-10) replaced them with native `Intl` in
 * `ZonedTimeSystem` and the plain `Money` struct, and Phase 4b removed both
 * packages; their bans stay as retired-package guards.
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
        'libphonenumber-js may only be imported from libs/ecs-core/src/systems/phone.system.ts — use PhoneSystem and the PhoneNumber component instead.',
    },
  ],
  paths: [
    {
      name: 'dinero.js',
      message:
        'dinero.js is retired (D4): money is integer `…Cents: PriceCents` beside a `currency: Currency`, and arithmetic the plain Money { amountCents, currency } struct of libs/ecs-core/src/components/money.data.ts.',
    },
    {
      name: 'luxon',
      message:
        'luxon is retired (D5, Law 7.1): zone math is native Intl inside libs/ecs-core/src/systems/zoned-time.system.ts — instants are UtcEpochMs, converted once at ingestion with ZonedTimeSystem.toUtc/toLocal and the location timeZone.',
    },
  ],
};

/**
 * `@creativo/<lib>/testing` entry points and `@core/testing` (libs/ecs-core's
 * test-support tier, Law 8) hold TEST SUPPORT — a port's
 * executable contract, its in-memory reference adapter, fixtures — kept off
 * the production barrels so a provider can never be handed one
 * (`libs/features/marketing/landing/src/testing.ts`, behind
 * `@creativo/features/marketing/landing/testing`). Specs import them;
 * nothing else may. Exported for the projects that restate
 * `no-restricted-imports` for their own exempt zone (apps/functions,
 * libs/infrastructure/*, libs/ecs-core): a restated rule drops this half
 * unless it lists it.
 */
export const TESTING_ENTRY_POINT_RESTRICTION = {
  group: ['@creativo/**/testing', '@core/testing'],
  message:
    '@creativo/**/testing and @core/testing entry points are test support (contracts, in-memory adapters, fixtures) — import them from specs (*.spec.ts) only, never from production code.',
};

/**
 * The ECS lint pieces the project-scoped configs (libs/ecs-core,
 * apps/functions, libs/ui/icons) restate, re-exported from HERE on purpose: this file
 * belongs to no Nx project, but a project config importing
 * tools/lint-rules directly gives that project a graph edge to
 * `lint-rules` — and the functions build then writes eslint's parsers into
 * its generated package.json (caught by tools/verify/p0/functions-deps.mjs).
 */
export {
  ECS_ALL_SUFFIXES,
  ECS_DATE_RESTRICTIONS,
  ECS_ID_CAST_RESTRICTIONS,
  ECS_PRIMITIVE_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
  PARENT_SEGMENT_REGEX,
  UI_RAW_PRIMITIVE_RESTRICTIONS,
  ecsProjectBlocks,
} from './tools/lint-rules/index.mjs';

/**
 * The local plugin itself, for the project configs that install one of its
 * TypeScript rules (libs/ecs-core: `creativo/no-restricted-import-expressions`,
 * Law 8's lazy-import half) — same reason as above: through this file, never
 * by importing tools/lint-rules.
 */
export { creativo };

/**
 * The UI-residue guards (docs/architecture/flips/ui-residue-cleanup.md §3)
 * run on production code only. Test support is not production: specs and
 * type-specs, `testing/` folders (`FakeFirestore`, the fixtures, the
 * `StubResizeObserver` rig), `test-setup.ts` polyfills and the Playwright
 * `e2e/` tooling (UR-8). Every pattern is `**\/`-prefixed so it matches
 * under BOTH basePaths (the note above the import cages).
 */
export const PRODUCTION_TS_IGNORES = [
  '**/*.spec.ts',
  '**/*.type-spec.ts',
  '**/testing/**',
  '**/test-setup.ts',
  '**/e2e/**',
  '**/*.d.ts',
];

/**
 * The web UI layer, as path FRAGMENTS matched against the linted file's
 * physical path (`include` of the clock and discriminator guards):
 * features, design system, shared and infrastructure libs, the web app and
 * the showcase. `apps/functions` (its composition root is the sanctioned
 * backend clock) and `libs/ecs-core` (its own suffix and project bans) are
 * outside it.
 */
const UI_LAYER_FRAGMENTS = [
  '/libs/features/',
  '/libs/ui/',
  '/libs/shared/',
  '/libs/infrastructure/',
  '/apps/web/src/',
  '/apps/showcase/src/',
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
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
          // Law 8: libs/ecs-core imports its own tier aliases
          // (`@core/primitives` … `@core/pipelines`) across tiers; only
          // same-tier siblings use `./x`.
          allowCircularSelfDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Scope isolation: a project can only depend on its own scope
            // plus scope:shared. The ECS core (libs/ecs-core, `type:domain`)
            // and the `infrastructure`/`ui` libs are all scope:shared; every
            // `type:feature` lib is `scope:app`.
            //
            // `scope:app` replaced the four product-surface scopes
            // (marketing/client/staff/admin) on 2026-07-28 — owner ruling:
            // this is ONE app, and the split was legacy structure whose only
            // practical effect was blocking legitimate edges (the shell's
            // account chrome reading the client session model). Cross-surface
            // isolation was never the boundary that mattered here; the
            // LAYERING rules below — which keep domain/infrastructure/ui
            // from ever seeing a feature — are, and they are untouched.
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
            // frontend-app-shaped scopes above — see the `## scope:backend`
            // section of docs/architecture/module-boundaries.md for why this
            // isn't just scope:shared.
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
            // Layering (docs/architecture/module-boundaries.md): keeps the
            // arrows one-way — ui never sees infrastructure or a feature,
            // infrastructure never sees ui or a feature and is the only
            // library layer where firebase/* resolves (enforced below via
            // no-restricted-imports), domain (libs/ecs-core) only ever
            // depends on domain.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
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
              // of libs/ecs-core (`@core/*`, tagged `type:domain`) straight from
              // its stores and `computed()`s — there is no view-model layer
              // in between (.claude/rules/angular-ui.md).
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:infrastructure',
                'type:domain',
                'type:util',
              ],
            },
            {
              // `type:domain` added 2026-07-25 (auth-flow design, slice
              // "UiPhoneField"): DS composites may consume the PURE ECS core
              // (libs/ecs-core: branded primitives, plain data and pure
              // systems — zero Angular, zero IO — e.g. the `PhoneSystem`
              // UiPhoneField imports lazily from `@core/systems` for
              // as-you-type formatting, owner ruling F6). The critical arrow
              // is unchanged: ui never sees `infrastructure` or a feature —
              // see docs/architecture/module-boundaries.md.
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
              // `firebase-auth`, `storage`) takes the `FIREBASE_*` SDK
              // singleton tokens (and `provideLazyPort`) from
              // `infrastructure/firebase-app`, whose providers resolve the
              // SDK once and bind the `@core/ports` bundles to their
              // adapters. That shared wiring is what the edge is for,
              // not a general license for one adapter concern to reach into
              // an unrelated one.
              sourceTag: 'type:infrastructure',
              onlyDependOnLibsWithTags: [
                'type:infrastructure',
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
              // `seed-tools` (tools/seed), retagged from `type:util` in ECS
              // migration Phase 3a: its fixture bodies
              // (`tools/seed/fixtures/*.ts`) import their entity types from
              // `@core/entities` (`type:domain`) to `satisfies
              // Omit<XEntity, 'id'>` them, which the `type:util` row above
              // forbids. Never infrastructure: a fixture is a document body,
              // not an adapter's input.
              sourceTag: 'type:tooling',
              onlyDependOnLibsWithTags: [
                'type:tooling',
                'type:util',
                'type:domain',
              ],
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
  // Firebase/dinero/luxon/libphonenumber restrictions (the "Import cages" of
  // docs/architecture/module-boundaries.md), plus the testing entry points
  // outside specs (round 6, 2026-09-26).
  // ESLint resolves every `files`/`ignores` pattern against a basePath that
  // depends on HOW it is invoked. Each project's `lint` target is the
  // `@nx/eslint:lint` executor: it `chdir`s to the WORKSPACE root and passes
  // the project's own eslint.config.mjs as `overrideConfigFile`, so the
  // basePath is the workspace root. Directory lookup — an IDE, or `eslint`
  // run inside a project — finds that same nested config and uses the
  // PROJECT dir as basePath. A repo-root-relative pattern
  // (`libs/infrastructure/firestore/**`) therefore matches under the
  // executor and never under lookup (the prefix is already the base), and a
  // project-relative one (`src/systems/**`) the reverse — silently, either
  // way (libs/ecs-core writes each of its `src/…` globs for both bases —
  // `fromEitherBase`, ui-residue-cleanup.md §10 OQ-12). That is why
  // the UI-residue guards below decide their scope from the file's physical
  // path, not from a glob. So these rules are unconditional here, and the
  // exempt zones (`libs/infrastructure/*` and `apps/functions` for firebase;
  // libs/ecs-core's `src/systems/phone.system.ts` for libphonenumber) turn
  // the relevant half off in their OWN eslint.config.mjs instead — see the
  // `no-restricted-imports` overrides in apps/functions/eslint.config.mjs,
  // the libs/infrastructure/*/eslint.config.mjs of the projects that import
  // firebase, and libs/ecs-core/eslint.config.mjs. The one exempt zone that is NOT
  // a project — Playwright's Node-side tooling under `apps/*/e2e/` — has no
  // config of its own and is linted under both basePaths (the executor's
  // workspace root and a direct `eslint apps/web/e2e` from the root; the
  // app dir for `eslint e2e` run inside apps/web), so its exemption lives
  // here, as a basePath-independent pattern, right after the two rule
  // blocks below.
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
    // half without the testing one. `*.type-spec.ts` (compile-time
    // assertions, type-checked by their lib's tsconfig.spec.json) are specs
    // too: libs/ecs-core's take their fixtures from `@core/testing`.
    files: ['**/*.spec.ts', '**/*.type-spec.ts'],
    rules: {
      'no-restricted-imports': ['error', LAYER_IMPORT_RESTRICTIONS],
    },
  },
  {
    // Playwright e2e tooling (apps/web/e2e/support) mints Firebase Admin
    // custom tokens and seeds the emulators directly, and its fixtures come
    // from the `@creativo/**/testing` and `@core/testing` entry points — it is test support that
    // never ships in an app bundle, so neither half of the boundary applies
    // (blueprint §1.2). `**/e2e/**` on purpose, not `apps/web/e2e/**`: a
    // `files` pattern is resolved against ESLint's basePath, and this folder
    // is linted under both of them (see the note above).
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
  // tools/lint-rules/icon-syntax.mjs and are tested there. The same two
  // every-file blocks carry the flatten pass's L7 (flatten-spec §7, D29): no
  // cast to `UserId` or `CustomerId` anywhere in the workspace — an id of
  // either brand comes only from its companion. Specs may still cast to
  // UiIconName to exercise the runtime fallback.
  ...ecsRootEveryFileBlocks(),
  // Law 7.4 in the features and the design system (pass D, D-13.1): a member
  // of a type alias or an interface named as an id, an instant, money or a
  // shop day (L3's one name list, `*Minutes` included — a time of day is
  // MinuteOfDay/EndMinute/TrackMinute, a length DurationMinutes/MinuteCount —
  // plus `*Ms` and `today`/`dayKey`/`todayKey`) is its brand, never a raw
  // `number`/`string` — D-3's opaque UI keys allowed by name. Its `basePath`
  // is THIS directory, absolute, so the two repo-root globs hold under both
  // ESLint base paths (the note above the import cages); it restates the
  // every-file icon and L7 guards (options replace); specs and test support
  // keep the blocks above; it sits before the suffix blocks so a suffix file
  // keeps its kind's list. libs/ui/icons lifts only the icon selectors on its
  // non-suffix files (the registry boundary) and restates this guard and L7
  // there (pass E, E-5).
  // Selectors and specs: tools/lint-rules/ecs-syntax.mjs; both base paths:
  // tools/lint-rules/ecs-core-base-paths.spec.mjs.
  uiRawPrimitiveBlock({
    basePath: import.meta.dirname,
    ignores: PRODUCTION_TS_IGNORES,
  }),
  // ── ECS file kinds (CLAUDE.md §1–2) ───────────────────────────────────
  // One `files:` block per suffix — AST selectors cannot see file names, so
  // spreading the ECS selectors into the `**/*.ts` block above would fire
  // `Date.now`, the import bans and the optional-property ban across the
  // whole repo. Each block restates `[...ICON_SYNTAX_RESTRICTIONS,
  // ...ECS_<SUFFIX>_RESTRICTIONS, ...ECS_TOKEN_RESTRICTIONS]` because options
  // replace, never merge; systems also get `no-restricted-globals`, data,
  // entities and primitives turn `@typescript-eslint/no-namespace` off for
  // their one type-only namespace, systems, data and primitives turn
  // `security/detect-object-injection` off, ports get
  // `consistent-type-imports`. Every suffix array carries the flatten-pass
  // guards (Laws 6 and 7, flatten-spec §7): no `kind`/`type`/`status`, no
  // nested 1-to-1 type (data, entities, primitives), no raw
  // coordinate/money/id, no `Date`, no `throw`, no `UserId`/`CustomerId`
  // cast. All eight suffixes live here — `*.port.ts` and `*.adapter.ts`
  // included, wherever they sit (libs/ecs-core/src/ports,
  // apps/functions/src/adapters, libs/infrastructure/*) — each with the
  // `InjectionToken` guard (Law 4). The guard rides on the suffix blocks
  // only, never on every `*.ts`: the web's Angular wiring
  // (`ports.tokens.ts`, the SDK providers, the `libs/ui/*` tokens,
  // `app.config.ts`) declares its tokens lawfully, so the every-file half
  // stays in libs/ecs-core's and apps/functions' own configs
  // (`ecsProjectBlocks`), where no Angular lives. Selectors live in
  // tools/lint-rules/ecs-syntax.mjs and are tested there.
  ...ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra: ECS_TOKEN_RESTRICTIONS }),
  // Law 9 — bottom-up port composition: no `Pick`/`Omit` slice of a `*Ports`
  // bundle anywhere (pipelines, adapters, composition roots, features,
  // specs). Tested in tools/lint-rules/no-sliced-ports.spec.mjs.
  {
    files: ['**/*.ts'],
    plugins: { creativo },
    rules: { 'creativo/no-sliced-ports': 'error' },
  },
  // Law 7.5 — an `*ErrorCode` / `*RefusalCode` dictionary lives only in a
  // `*.error.ts` (the `@core/errors` tier; `primitives/primitive.error.ts`
  // below it). The rule reads the physical filename, so it holds from either
  // base path. Tested in tools/lint-rules/error-dictionary-home.spec.mjs.
  {
    files: ['**/*.ts'],
    plugins: { creativo },
    rules: { 'creativo/error-dictionary-home': 'error' },
  },
  // Law 10 — presenters, display models and their wording helpers
  // (`*.presenter.ts`, `*.vm.ts`, `*.words.ts`, `*.format.ts`) are pure: no
  // class, Angular, I/O, async, clock or randomness. The rule scopes itself
  // by the physical filename. Tested in tools/lint-rules/presenter-purity.spec.mjs.
  {
    files: ['**/*.ts'],
    plugins: { creativo },
    rules: { 'creativo/presenter-purity': 'error' },
  },
  // No no-op mappers (Law 5 zero-mapper, Law 3 zero inbound mapping, Law 1): a function that copies
  // its argument into the type it already has, a `LocalizedText` copied field by field, or a module
  // function / companion member / private member that only forwards its own arguments to another
  // function. Tested in tools/lint-rules/no-identity-mapper.spec.mjs.
  {
    files: ['**/*.ts'],
    ignores: [...PRODUCTION_TS_IGNORES, '**/test-support/**'],
    plugins: { creativo },
    rules: { 'creativo/no-identity-mapper': 'error' },
  },
  // WS-4.6 (audit-hardening RU-8, RU-9, RU-37) — a structured log line's
  // message is a `LogEvent` value (`@core/primitives`), never a string
  // literal: `ports.log('warn', LogEvent.BookingRejected, { errorCode })`.
  // Every production `.ts` file; specs and test support stay free to spell
  // a line. The two recorded exemptions: the emulator-only console OTP line
  // (a justified `eslint-disable-next-line`) and the client-issue sink's
  // non-literal `line.msg`, which the rule never reports. Tested in
  // tools/lint-rules/no-literal-log-message.spec.mjs.
  {
    files: ['**/*.ts'],
    ignores: [...PRODUCTION_TS_IGNORES, '**/test-support/**'],
    plugins: { creativo },
    rules: { 'creativo/no-literal-log-message': 'error' },
  },
  // OR-33 (owner rulings 2026-10-26, DEP-F24) — the read guard is a required
  // parameter, and the registries that guard NOTHING are test support:
  // `unguarded` (@core/testing, libs/ecs-core/src/testing/unguarded.ts) and
  // the web's `UNGUARDED` (libs/infrastructure/firestore/src/testing/
  // unguarded.ts). Neither name is declared, imported or referenced outside
  // specs, `testing/` and `test-support/`. A core rule no other config sets,
  // so no later block replaces its options; `**/` patterns hold under both
  // ESLint base paths (the note above the import cages). A property READ
  // (`StoredDocumentSystem.unguarded`) is the type checker's: the systems
  // tier no longer has it. Runbook §4.10 proves it on.
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    ignores: ['**/*.spec.ts', '**/testing/**', '**/test-support/**'],
    rules: { 'id-denylist': ['error', 'UNGUARDED', 'unguarded'] },
  },
  // …and strict mode on every port file: no `Pick`/`Omit` at all — a port's
  // argument shape is a named type (.claude/rules/ecs-ports.md).
  // libs/ecs-core keeps its own `src/ports/**` strict block, which also
  // covers the ports barrel and the ports specs (neither is a `*.port.ts`).
  {
    files: ['**/*.port.ts'],
    plugins: { creativo },
    rules: { 'creativo/no-sliced-ports': ['error', { anyType: true }] },
  },
  // ── The UI-residue guards (ui-residue-cleanup.md §3, UR-12) ────────────
  // Four rules, not `no-restricted-syntax` entries: a later block REPLACES
  // that rule's options, and libs/ui/icons turns it off on its non-suffix
  // files, so a selector there could be erased; a separate rule name cannot.
  // Scope is decided INSIDE each rule — `include` / `allowIn` /
  // `allowRandomIn` path fragments matched against the file's physical path
  // (the `icon-registry-only` `allowInlineSvg` precedent) — never by a
  // `files` glob, which is silently off under one of the two basePaths (the
  // note above the import cages). Hence `**/*.ts` and `**/` ignores only, and
  // no second path block. Each allowlist entry carries its reason; a new
  // entry is a decision for the plan, not a shortcut. Rules and their
  // RuleTester specs: tools/lint-rules/no-{undecorated-class,ambient-clock,
  // generic-discriminator,hand-built-load-slice}.mjs; runbook §4.9 gate 5
  // proves both basePaths.
  {
    // CLAUDE.md §2: `class` only in the Angular row — a called `@Component`,
    // `@Directive`, `@Pipe`, `@Injectable` or `@NgModule`. Everything else is
    // a plain object from a factory (`visitClockOf`, `edgeScrollerOf`,
    // `injectFrameFullscreen`, `consoleUiIconReporter`). Every app and lib
    // (libs/ecs-core and apps/functions overlap their own class bans:
    // defence in depth); tools/** stays out (Node script classes, OQ-6).
    files: ['**/*.ts'],
    ignores: PRODUCTION_TS_IGNORES,
    plugins: { creativo },
    rules: {
      'creativo/no-undecorated-class': [
        'error',
        { include: ['/libs/', '/apps/'] },
      ],
    },
  },
  {
    // Law 7: no ambient clock, date object or entropy read in the UI layer —
    // `inject(CLOCK_PORTS).nowUtcMs()` (specs pin `memoryClockPorts`),
    // `ZonedTimeSystem`, `LocalDate`, the `@creativo/ui/wall-clock`
    // formatters, `ID_PORTS`. `Date.UTC` and `performance.now()` stay legal.
    files: ['**/*.ts'],
    ignores: PRODUCTION_TS_IGNORES,
    plugins: { creativo },
    rules: {
      'creativo/no-ambient-clock': [
        'error',
        {
          include: UI_LAYER_FRAGMENTS,
          // The sanctioned clock and entropy ADAPTERS, by exact path — every
          // other infrastructure file stays guarded (UR-10).
          allowIn: [
            // `browserClockPorts` / `browserIdPorts`: the one place the web
            // reads `Date.now()` and `crypto.randomUUID()`, behind
            // CLOCK_PORTS and ID_PORTS.
            '/libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts',
            // The Firebase session adapter stamps `iat`/`exp` (epoch
            // seconds) on the UNSIGNED custom token it mints for the Auth
            // emulator only — an SDK seam, not a UI read.
            '/libs/infrastructure/firebase-auth/src/lib/auth-session.adapter.ts',
          ],
          // Files where ONLY `Math.random` is lifted; every clock form stays
          // reported there (UR-10).
          allowRandomIn: [
            // Equal-jitter retry backoff: the policy is injectable through
            // the cache's `policy` parameter and its spec pins `Math.random`
            // — a `RandomPorts` bundle for retry jitter would be ceremony.
            '/libs/features/shared/catalog/src/lib/content/media-url-cache.ts',
            // A purely visual particle effect; nothing observable depends on
            // where a confetto lands.
            '/libs/ui/patterns/src/lib/confetti/confetti.ts',
          ],
        },
      ],
    },
  },
  {
    // Law 6.2 for view state and every other UI union: no `kind`/`type`/
    // `status` property signature — a domain-prefixed discriminator
    // (`loadState: LoadState`, `pagingState: PagingState`,
    // `bookingStatus: BookingStatus`) with SCREAMING values from its
    // `as const` dictionary. Object-literal properties (`Intl` options, a
    // CSS height key) are not signatures and are not reported.
    files: ['**/*.ts'],
    ignores: PRODUCTION_TS_IGNORES,
    plugins: { creativo },
    rules: {
      'creativo/no-generic-discriminator': [
        'error',
        {
          // No allow-list: the icon manifest's asset discriminator is
          // `iconAsset` since schema 2 (pass D, DEP-16), so the manifest is
          // checked like every other UI file.
          include: UI_LAYER_FRAGMENTS,
        },
      ],
    },
  },
  {
    // Reuse, never copy (UR-2): a `LoadSlice` comes from its companion —
    // `LoadSlice.ready(data)`, `LoadSlice.loading`, `LoadSlice.failed`,
    // `LoadSlice.empty` — never a hand-built `{ loadState: LoadState.… }`
    // literal. A literal with any other field or a spread (a paging or page
    // state) is a different slice type and is not reported.
    files: ['**/*.ts'],
    ignores: PRODUCTION_TS_IGNORES,
    plugins: { creativo },
    rules: {
      'creativo/no-hand-built-load-slice': [
        'error',
        {
          include: UI_LAYER_FRAGMENTS,
          // The companion's own home: it is where the variants are built.
          allowIn: ['/libs/shared/view-state/'],
        },
      ],
    },
  },
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
