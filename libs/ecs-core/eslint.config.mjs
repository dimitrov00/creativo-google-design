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
  TESTING_ENTRY_POINT_RESTRICTION,
  ecsProjectBlocks,
} from '../../eslint.config.mjs';

/**
 * The layer import rule minus one package, for the one file allowed it. A
 * rule's options replace, never merge, so the rest is restated: the
 * firebase ban, the other caged packages and — in production code — the
 * testing entry points.
 */
function layerImportsWithout(packageName, { production }) {
  const patterns = LAYER_IMPORT_RESTRICTIONS.patterns.filter(
    (pattern) => !pattern.group.includes(packageName),
  );
  return {
    patterns: production
      ? [...patterns, TESTING_ENTRY_POINT_RESTRICTION]
      : patterns,
    paths: LAYER_IMPORT_RESTRICTIONS.paths.filter(
      (path) => path.name !== packageName,
    ),
  };
}

export default [
  ...baseConfig,
  // The InjectionToken guard on every file, and the `*.port.ts` /
  // `*.adapter.ts` blocks beside the root's suffix blocks (restated with the
  // token guard). Project-scoped in Phase 1 because at the root they would
  // hit libs/application's legacy port files and class adapters; Phase 4
  // moves them to the root config (blueprint §6 Phase 1). L4 — no `Date` —
  // reaches every file of the core, specs and test support included
  // (flatten-spec §7).
  ...ecsProjectBlocks({ everyFile: ECS_DATE_RESTRICTIONS }),
  {
    // L7's one exemption: the id family's own file mints `UserId` and
    // `CustomerId` (`CustomerId.forUser`), so it restates the primitive list
    // without the cast guard.
    files: ['src/primitives/ids.primitive.ts'],
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
    files: ['src/systems/zoned-time.system.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ICON_SYNTAX_RESTRICTIONS,
        ...ECS_ZONED_TIME_RESTRICTIONS,
        ...ECS_TOKEN_RESTRICTIONS,
      ],
    },
  },
  {
    // The libphonenumber cage: PhoneSystem is its only importer (CLAUDE.md
    // §3). Only that one package is exempt; firebase, luxon, dinero and the
    // testing entry points stay banned in this file too.
    files: ['src/systems/phone.system.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        layerImportsWithout('libphonenumber-js', { production: true }),
      ],
    },
  },
  {
    // Spec-only: a property test of Money's integer arithmetic against
    // dinero.js (Risk 10), deleted with dinero itself. `money.data.ts`
    // imports no package — a `*.data.ts` never may.
    files: ['src/components/money.data.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        layerImportsWithout('dinero.js', { production: false }),
      ],
    },
  },
];
