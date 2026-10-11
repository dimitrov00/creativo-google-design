import baseConfig, {
  TESTING_ENTRY_POINT_RESTRICTION,
  ecsProjectBlocks,
} from '../../eslint.config.mjs';

/**
 * This project's import restrictions (the layer rule minus the half this
 * project is allowed), shared by its production rule and its spec rule.
 */
const IMPORT_RESTRICTIONS = {
  paths: [
    {
      name: 'dinero.js',
      message:
        'dinero.js is retired (D4): money is integer `…Cents: PriceCents` beside a `currency: Currency`, and arithmetic the plain Money { amountCents: PriceCents; currency: Currency } struct of libs/ecs-core/src/components/money.data.ts (only the legacy libs/domain/kernel/** keeps dinero, until Phase 4).',
    },
    {
      name: 'luxon',
      message:
        'luxon is retired (D5, Law 7.1): zone math is native Intl inside libs/ecs-core/src/systems/zoned-time.system.ts — instants are UtcEpochMs, converted once at ingestion with ZonedTimeSystem.toUtc/toLocal and the location timeZone (only the legacy libs/domain/kernel/** keeps luxon, until Phase 4).',
    },
    {
      name: 'libphonenumber-js',
      message:
        'libphonenumber-js may only be imported from libs/ecs-core/src/systems/phone.system.ts (and the legacy libs/domain/kernel/** until Phase 4) — use PhoneSystem and the PhoneNumber component instead.',
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
    // One of the two places firebase-admin may be imported directly
    // (blueprint §0.3/§1.2) — override the workspace-wide
    // no-restricted-imports rule to drop the firebase half, keeping the
    // dinero/luxon/libphonenumber half (Cloud Functions go through the
    // ecs-core Money struct, ZonedTimeSystem and PhoneSystem — or the legacy
    // kernel's wrappers until Phase 4 — never the raw libs). See the comment
    // in the root eslint.config.mjs for why this lives here instead of an
    // `ignores` pattern on the shared rule.
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
  // ports as closure parameters, never through a container), and the seven
  // ECS suffix blocks restated with it — `*.port.ts` and `*.adapter.ts`
  // included, which the root config cannot carry until Phase 4 deletes
  // libs/application's legacy ports and class adapters (blueprint §6
  // Phase 1). Last, so these options win over the root's.
  ...ecsProjectBlocks(),
];
