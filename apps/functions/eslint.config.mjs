import baseConfig, {
  TESTING_ENTRY_POINT_RESTRICTION,
  ecsProjectBlocks,
} from '#eslint-config';

/**
 * This project's import restrictions (the layer rule minus the half this
 * project is allowed), shared by its production rule and its spec rule.
 */
const IMPORT_RESTRICTIONS = {
  paths: [
    {
      name: 'dinero.js',
      message:
        'dinero.js is retired (D4): money is integer `…Cents: PriceCents` beside a `currency: Currency`, and arithmetic the plain Money { amountCents: PriceCents; currency: Currency } struct of libs/ecs-core/src/components/money.data.ts.',
    },
    {
      name: 'luxon',
      message:
        'luxon is retired (D5, Law 7.1): zone math is native Intl inside libs/ecs-core/src/systems/zoned-time.system.ts — instants are UtcEpochMs, converted once at ingestion with ZonedTimeSystem.toUtc/toLocal and the location timeZone.',
    },
    {
      name: 'libphonenumber-js',
      message:
        'libphonenumber-js may only be imported from libs/ecs-core/src/systems/phone.system.ts — use PhoneSystem and the PhoneNumber component instead.',
    },
  ],
};

/**
 * Production code also may not import a testing entry point of a @creativo lib
 * (test support); a rule's options replace, never merge, so the root
 * config's testing half is restated here, and the spec block below drops it.
 */
function withTestingRestriction(restrictions) {
  return {
    ...restrictions,
    patterns: [
      ...(restrictions.patterns ?? []),
      TESTING_ENTRY_POINT_RESTRICTION,
    ],
  };
}

export default [
  ...baseConfig,
  {
    // One of the two places firebase-admin may be imported directly (the
    // "Import cages" of docs/architecture/module-boundaries.md) — override
    // the workspace-wide no-restricted-imports rule to drop the firebase
    // half, keeping the dinero/luxon/libphonenumber half (Cloud Functions go
    // through the ecs-core Money struct, ZonedTimeSystem and PhoneSystem,
    // never the raw libs; dinero.js and luxon are retired, their bans kept
    // as guards). See the comment in the root eslint.config.mjs for why this
    // lives here instead of an `ignores` pattern on the shared rule.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        withTestingRestriction(IMPORT_RESTRICTIONS),
      ],
    },
  },
  {
    // Specs are what the testing entry points are for.
    files: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', IMPORT_RESTRICTIONS],
    },
  },
  // The InjectionToken guard on every file here (the backend composes
  // ports as closure parameters, never through a container; the root
  // carries the guard on the eight suffix blocks only, because the web's
  // Angular wiring declares tokens lawfully), and the root's eight ECS
  // suffix blocks restated after it, so its options do not replace theirs.
  // Imported through `#eslint-config`, never tools/lint-rules: a direct
  // import would add a graph edge and grow the functions dist. Last, so
  // these options win over the root's.
  ...ecsProjectBlocks(),
];
