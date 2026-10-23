/**
 * The generated-`package.json` check (blueprint docs/architecture/
 * ecs-migration.md §6 Phase 1): `pnpm nx build functions` writes
 * `dist/apps/functions/package.json` from the project graph, so its
 * `dependencies` keys are the runtime packages the Cloud Functions deploy
 * installs. A new graph edge (a lib the functions start importing, or a
 * config file that imports tooling) silently grows that list. The check
 * asserts two things, in this order:
 *
 * 1. No forbidden key (`FORBIDDEN_FUNCTIONS_DEPS`) — the blueprint's
 *    end-of-Phase-3b assertion, kept as code: Phase 4a took `@angular/*`
 *    and `luxon` out of the dist, Phase 4b `dinero.js` (with the money
 *    spec's cross-check, phase-4b-delete.md 4B-6, 4B-8). A forbidden key
 *    fails the check before any baseline comparison, and it can never be
 *    recorded. `rxjs` stays (phase-4a-repoint.md 4A-15, §10.1): Nx's
 *    `createPackageJson` scans the transitive projects whole, and
 *    ecs-core's ports name `Observable`.
 * 2. The keys equal the baseline recorded beside this file.
 *
 * Pure apart from reading the two files (and `--record` writing one), and
 * no emulator — so it runs both inside `verify-p0.mjs` (check f) and alone
 * through `node tools/verify/p0/check-functions-deps.mjs`.
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

/**
 * Packages the functions dist must never list: Angular is the web app's
 * framework, `luxon` and `dinero.js` (with `@types/luxon`) were the legacy
 * kernel's time and money libraries — time is native `Intl`, money integer
 * cents (CLAUDE.md §3). A string matches one key exactly; a RegExp (never
 * global, so `test` keeps no state) matches a family.
 */
export const FORBIDDEN_FUNCTIONS_DEPS = [
  /^@angular\//,
  'luxon',
  '@types/luxon',
  'dinero.js',
];

const isForbidden = (key) =>
  FORBIDDEN_FUNCTIONS_DEPS.some((rule) =>
    typeof rule === 'string' ? key === rule : rule.test(key),
  );

/** The keys `FORBIDDEN_FUNCTIONS_DEPS` refuses, sorted. */
export function forbiddenDependencyKeys(keys) {
  return keys.filter(isForbidden).sort();
}

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

/** The build's dependency keys; throws naming any forbidden one. */
function permittedDependencyKeys(packageJsonPath) {
  const keys = dependencyKeysOf(
    readText(packageJsonPath, 'run `pnpm nx build functions` first.'),
  );
  const forbidden = forbiddenDependencyKeys(keys);
  if (forbidden.length > 0) {
    throw new Error(
      [
        `${relative(WORKSPACE_ROOT, packageJsonPath)} lists a forbidden runtime dependency`,
        `forbidden: ${forbidden.join(', ')}`,
        'The functions never ship @angular/*, luxon, @types/luxon or dinero.js; remove the graph edge that brought it in (re-recording cannot accept it).',
      ].join('\n      '),
    );
  }
  return keys;
}

/**
 * Refuses a forbidden key, then compares the build's dependency keys with
 * the baseline. Returns the evidence line on a match; throws with the
 * forbidden or the added/removed keys otherwise.
 */
export function checkFunctionsDeps({
  packageJsonPath = FUNCTIONS_PACKAGE_JSON,
  baselinePath = FUNCTIONS_DEPS_BASELINE,
} = {}) {
  const actual = permittedDependencyKeys(packageJsonPath);
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
  return `${actual.length} runtime dependencies, as recorded, none forbidden: ${actual.join(', ')}`;
}

/**
 * Writes the build's current dependency keys as the new baseline. Refuses
 * (throws, writing nothing) when the build lists a forbidden key.
 */
export function recordFunctionsDeps({
  packageJsonPath = FUNCTIONS_PACKAGE_JSON,
  baselinePath = FUNCTIONS_DEPS_BASELINE,
  recordedAt = new Date().toISOString().slice(0, 10),
} = {}) {
  const keys = permittedDependencyKeys(packageJsonPath);
  const baseline = {
    '//': 'The dependency keys of the generated dist/apps/functions/package.json (pnpm nx build functions). Checked by tools/verify/p0/functions-deps.mjs, which first refuses @angular/*, luxon, @types/luxon and dinero.js (none can be recorded; rxjs stays, phase-4a-repoint.md §10.1); re-record with `node tools/verify/p0/check-functions-deps.mjs --record` only for an intended change, and say why in the commit.',
    recordedAt,
    dependencies: keys,
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  return keys;
}
