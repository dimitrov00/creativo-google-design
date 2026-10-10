/**
 * The generated-`package.json` check (blueprint docs/architecture/
 * ecs-migration.md §6 Phase 1): `pnpm nx build functions` writes
 * `dist/apps/functions/package.json` from the project graph, so its
 * `dependencies` keys are the runtime packages the Cloud Functions deploy
 * installs. A new graph edge (a lib the functions start importing, or a
 * config file that imports tooling) silently grows that list. The Phase 1
 * gate asserts it equals the baseline recorded beside this file; the end of
 * Phase 3b re-records it with `@angular/*` and `rxjs` gone.
 *
 * Pure apart from reading the two files, and no emulator — so it runs both
 * inside `verify-p0.mjs` (check f) and alone through
 * `node tools/verify/p0/check-functions-deps.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../../..');

export const FUNCTIONS_PACKAGE_JSON = resolve(
  WORKSPACE_ROOT,
  'dist/apps/functions/package.json',
);
export const FUNCTIONS_DEPS_BASELINE = resolve(
  HERE,
  'functions-deps.baseline.json',
);

/** Keys present on one side only, each list sorted. */
export function diffDependencyKeys(actualKeys, baselineKeys) {
  const actual = new Set(actualKeys);
  const baseline = new Set(baselineKeys);
  return {
    added: [...actual].filter((key) => !baseline.has(key)).sort(),
    removed: [...baseline].filter((key) => !actual.has(key)).sort(),
  };
}

/** The sorted `dependencies` keys of a generated package.json's text. */
export function dependencyKeysOf(packageJsonText) {
  const parsed = JSON.parse(packageJsonText);
  return Object.keys(parsed.dependencies ?? {}).sort();
}

function readText(path, hint) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${relative(WORKSPACE_ROOT, path)} is missing — ${hint}`);
  }
}

/**
 * Compares the build's dependency keys with the baseline. Returns the
 * evidence line on a match; throws with the added/removed keys otherwise.
 */
export function checkFunctionsDeps({
  packageJsonPath = FUNCTIONS_PACKAGE_JSON,
  baselinePath = FUNCTIONS_DEPS_BASELINE,
} = {}) {
  const actual = dependencyKeysOf(
    readText(packageJsonPath, 'run `pnpm nx build functions` first.'),
  );
  const baseline = JSON.parse(
    readText(
      baselinePath,
      'record it with `node tools/verify/p0/check-functions-deps.mjs --record`.',
    ),
  ).dependencies;
  const { added, removed } = diffDependencyKeys(actual, baseline);
  if (added.length > 0 || removed.length > 0) {
    throw new Error(
      [
        `dist/apps/functions/package.json no longer matches ${relative(WORKSPACE_ROOT, baselinePath)}`,
        added.length > 0 ? `added: ${added.join(', ')}` : null,
        removed.length > 0 ? `removed: ${removed.join(', ')}` : null,
        'If the change is intended, re-record with --record and say why in the commit.',
      ]
        .filter(Boolean)
        .join('\n      '),
    );
  }
  return `${actual.length} runtime dependencies, as recorded: ${actual.join(', ')}`;
}

/** Writes the build's current dependency keys as the new baseline. */
export function recordFunctionsDeps({
  packageJsonPath = FUNCTIONS_PACKAGE_JSON,
  baselinePath = FUNCTIONS_DEPS_BASELINE,
  recordedAt = new Date().toISOString().slice(0, 10),
} = {}) {
  const keys = dependencyKeysOf(
    readText(packageJsonPath, 'run `pnpm nx build functions` first.'),
  );
  const baseline = {
    '//': 'The dependency keys of the generated dist/apps/functions/package.json (pnpm nx build functions). Checked by tools/verify/p0/functions-deps.mjs; re-record with `node tools/verify/p0/check-functions-deps.mjs --record` only for an intended change (blueprint §6: Phase 1 records, the end of Phase 3b re-records with @angular/* and rxjs absent).',
    recordedAt,
    dependencies: keys,
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  return keys;
}
