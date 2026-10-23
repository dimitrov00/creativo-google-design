// Everything comes through the root config: importing tools/lint-rules
// directly would give this project a graph edge to `lint-rules`.
import baseConfig, {
  ECS_DATE_RESTRICTIONS,
  ECS_ID_CAST_RESTRICTIONS,
  ECS_PRIMITIVE_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
  LAYER_IMPORT_RESTRICTIONS,
  PARENT_SEGMENT_REGEX,
  TESTING_ENTRY_POINT_RESTRICTION,
  creativo,
  ecsProjectBlocks,
} from '#eslint-config';

/**
 * Law 8 (CLAUDE.md): each folder of `src/` is one tier, exported only
 * through its own `@core/<tier>` barrel, and a PRODUCTION file of a tier may
 * import only the tiers listed here — the one-way hierarchy
 *
 *   primitives ──> errors ──> components ──> entities ──> systems ──> pipelines
 *                                                └──> ports ──────────────┘
 *
 * `testing` is the test-support tier (`@core/testing`): it sits above every
 * production tier, and specs and type-specs sit above it — a spec may import
 * any tier, because `@core/testing` already reaches all of them. Mirrored by
 * tools/verify/layering/check-layering.mjs, which also proves the graph has
 * no cycle; keep the two tables in step.
 */
const CORE_TIER_IMPORTS = new Map([
  ['primitives', []],
  ['errors', ['primitives']],
  ['components', ['errors', 'primitives']],
  ['entities', ['components', 'errors', 'primitives']],
  ['ports', ['entities', 'components', 'errors', 'primitives']],
  ['systems', ['entities', 'components', 'errors', 'primitives']],
  [
    'pipelines',
    ['systems', 'ports', 'entities', 'components', 'errors', 'primitives'],
  ],
  [
    'testing',
    [
      'primitives',
      'errors',
      'components',
      'entities',
      'ports',
      'systems',
      'pipelines',
    ],
  ],
]);

const PRODUCTION_TIERS = [...CORE_TIER_IMPORTS.keys()].filter(
  (tier) => tier !== 'testing',
);

/** A `regex` restriction on `@core/<one of tiers>` (and any subpath). */
function coreAliasRestriction(tiers, message) {
  return {
    regex: `^@core/(${tiers.join('|')})(/.*)?$`,
    caseSensitive: true,
    message,
  };
}

/**
 * Law 8.3: no parent traversal anywhere in the library's source — a `..`
 * segment anywhere in the specifier, so `./../x` and `./a/../../x` are
 * caught as surely as `../x`.
 */
const NO_PARENT_TRAVERSAL = {
  regex: PARENT_SEGMENT_REGEX,
  caseSensitive: true,
  message:
    'No `../` inside libs/ecs-core (Law 8.3): another tier is its `@core/<tier>` alias, a sibling in the same tier is `./x`.',
};

/**
 * The testing entry points, with `@core/testing` always among them in a
 * production file of the core — whatever the root restriction lists, and
 * never listed twice (a group matching twice would report every hit twice).
 */
const CORE_TESTING_ENTRY_POINT_RESTRICTION = {
  ...TESTING_ENTRY_POINT_RESTRICTION,
  group: [
    ...new Set([...TESTING_ENTRY_POINT_RESTRICTION.group, '@core/testing']),
  ],
};

/**
 * The tier half of `no-restricted-imports` for one file kind of one tier:
 * its own barrel (a tier importing itself through its barrel cycles), every
 * tier the hierarchy forbids it (production files only), and `../`.
 */
function tierRestrictions(tier, { test }) {
  const own = coreAliasRestriction(
    [tier],
    `\`@core/${tier}\` is this file's own tier barrel — import the sibling with \`./x\` (Law 8.3: a tier importing itself through its barrel cycles).`,
  );
  const allowed = CORE_TIER_IMPORTS.get(tier) ?? [];
  const forbidden = test
    ? []
    : PRODUCTION_TIERS.filter(
        (other) => other !== tier && !allowed.includes(other),
      );
  const upward =
    forbidden.length === 0
      ? []
      : [
          coreAliasRestriction(
            forbidden,
            allowed.length === 0
              ? `Law 8.2: src/${tier} imports nothing from the library — it is the bottom of the hierarchy (primitives → errors → components → entities → systems → pipelines, ports beside).`
              : `Law 8.2: src/${tier} may import only ${allowed.map((name) => `@core/${name}`).join(', ')} — the hierarchy runs one way (primitives → errors → components → entities → systems → pipelines, ports beside), and nothing inside the library but specs and test support imports pipelines.`,
          ),
        ];
  return [own, ...upward, NO_PARENT_TRAVERSAL];
}

/**
 * The FULL `no-restricted-imports` options for one file kind of one tier,
 * optionally minus one caged package for the one file allowed it. A rule's
 * options replace, never merge, so every block restates the whole set: the
 * firebase ban, the caged packages (`libphonenumber-js`, and the retired
 * `dinero.js` and `luxon`), the testing entry points in production code — test support
 * (`src/testing`) composes test support, and specs and type-specs are what
 * it is for — and the tier half above.
 */
function coreImports(tier, { test = false, exempt = null } = {}) {
  const layerPatterns = LAYER_IMPORT_RESTRICTIONS.patterns.filter(
    (pattern) => !(exempt && pattern.group?.includes(exempt)),
  );
  const production = !test && tier !== 'testing';
  return {
    patterns: [
      ...layerPatterns,
      ...(production ? [CORE_TESTING_ENTRY_POINT_RESTRICTION] : []),
      ...tierRestrictions(tier, { test }),
    ],
    paths: LAYER_IMPORT_RESTRICTIONS.paths.filter(
      (path) => path.name !== exempt,
    ),
  };
}

/** `@core/testing` as a `regex` pattern — the lazy half has no `group`. */
const CORE_TESTING_ALIAS = coreAliasRestriction(
  ['testing'],
  TESTING_ENTRY_POINT_RESTRICTION.message,
);

/**
 * The lazy half for one file kind of one tier: the same tier patterns, plus
 * `@core/testing` in a production file, for the specifiers
 * `no-restricted-imports` never reads — `import('…')`, `import('…').X` type
 * queries, `import x = require('…')` (`creativo/no-restricted-import-expressions`).
 * The package cages stay static-only: no file of the core imports a package
 * lazily, and the verifier does not police packages either.
 */
function coreImportExpressions(tier, { test = false } = {}) {
  const production = !test && tier !== 'testing';
  return {
    patterns: [
      ...(production ? [CORE_TESTING_ALIAS] : []),
      ...tierRestrictions(tier, { test }),
    ],
  };
}

/**
 * A `files` glob under this project's `src/`, written for BOTH base paths
 * ESLint may resolve it against: this project's directory (the inferred
 * `eslint .` lint target, run from `libs/ecs-core`) and the workspace root
 * (`eslint -c libs/ecs-core/eslint.config.mjs …` from the root, or an
 * `@nx/eslint:lint` target, which runs from there). A bare `src/…` glob
 * matches nothing from the root, and every rule it scopes would go silent.
 */
const fromEitherBase = (...globs) =>
  globs.flatMap((glob) => [glob, `libs/ecs-core/${glob}`]);

/** Per tier: its production files, then its specs and type-specs. */
const tierBlocks = [...CORE_TIER_IMPORTS.keys()].flatMap((tier) => [
  {
    files: fromEitherBase(`src/${tier}/**/*.ts`),
    rules: {
      'no-restricted-imports': ['error', coreImports(tier)],
      'creativo/no-restricted-import-expressions': [
        'error',
        coreImportExpressions(tier),
      ],
    },
  },
  {
    files: fromEitherBase(
      `src/${tier}/**/*.spec.ts`,
      `src/${tier}/**/*.type-spec.ts`,
    ),
    rules: {
      'no-restricted-imports': ['error', coreImports(tier, { test: true })],
      'creativo/no-restricted-import-expressions': [
        'error',
        coreImportExpressions(tier, { test: true }),
      ],
    },
  },
]);

export default [
  ...baseConfig,
  // The InjectionToken guard on every file (the root carries it on the eight
  // suffix blocks only — the web's Angular wiring declares tokens lawfully,
  // no Angular lives here), and the root's eight suffix blocks restated after
  // it so its options do not replace theirs. L4 — no `Date` — reaches every
  // file of the core, specs and test support included (flatten-spec §7).
  ...ecsProjectBlocks({ everyFile: ECS_DATE_RESTRICTIONS }),
  {
    // L7's one exemption: the id family's own file mints `UserId` and
    // `CustomerId` (`CustomerId.forUser`), so it restates the primitive list
    // without the cast guard.
    files: fromEitherBase('src/primitives/ids.primitive.ts'),
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ICON_SYNTAX_RESTRICTIONS,
        ...ECS_PRIMITIVE_RESTRICTIONS.filter(
          (restriction) => !ECS_ID_CAST_RESTRICTIONS.includes(restriction),
        ),
        ...ECS_TOKEN_RESTRICTIONS,
      ],
    },
  },
  {
    // D5 (2026-10-10): zone math is native Intl, in ONE file. Its block
    // restates the full system list without the Intl selector — options
    // replace, never merge — so every other purity guard still holds here.
    // The file's module-level `Map<zone, Intl.DateTimeFormat>` cache is the
    // one sanctioned module state in any system (ecs-systems.md).
    files: fromEitherBase('src/systems/zoned-time.system.ts'),
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ICON_SYNTAX_RESTRICTIONS,
        ...ECS_ZONED_TIME_RESTRICTIONS,
        ...ECS_TOKEN_RESTRICTIONS,
      ],
    },
  },
  // The local plugin, for `creativo/no-restricted-import-expressions` (the
  // root registers the same plugin object for its own `creativo/*` rules,
  // none of which is that one).
  { files: ['**/*.ts'], plugins: { creativo } },
  // Law 9: the ports tier names its shapes — no `Pick`/`Omit` at all there.
  // The root reports a slice of a `*Ports` bundle everywhere and every
  // `Pick`/`Omit` in a `*.port.ts`; this block adds the rest of the tier
  // (the ports barrel and the ports specs).
  {
    files: fromEitherBase('src/ports/**/*.ts'),
    rules: { 'creativo/no-sliced-ports': ['error', { anyType: true }] },
  },
  // Law 8: the tier hierarchy, the own-barrel ban and the `../` ban, one
  // block per tier and file kind — static imports through
  // `no-restricted-imports`, `import()` / `import('…')` type queries /
  // `import = require()` through `creativo/no-restricted-import-expressions`.
  // They come after the root's `no-restricted-imports` blocks and before the
  // package exemption below, which restates the static half only (the lazy
  // half it leaves untouched).
  ...tierBlocks,
  {
    // The libphonenumber cage: PhoneSystem is its only importer (CLAUDE.md
    // §3). Only that one package is exempt; firebase, the retired luxon and
    // dinero.js bans, the testing entry points and the systems tier's Law 8
    // restrictions stay in force in this file too.
    files: fromEitherBase('src/systems/phone.system.ts'),
    rules: {
      'no-restricted-imports': [
        'error',
        coreImports('systems', { exempt: 'libphonenumber-js' }),
      ],
    },
  },
];
