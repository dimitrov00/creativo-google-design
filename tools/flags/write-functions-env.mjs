#!/usr/bin/env node
/**
 * The functions half of the build-time flags (R41, §12.1): turns one map of
 * config/feature-flags.json into the `.env` files the Firebase CLI reads for
 * the params in apps/functions/src/lib/flags.ts.
 *
 *   node tools/flags/write-functions-env.mjs                   # firebase.json predeploy; project from $GCLOUD_PROJECT
 *   node tools/flags/write-functions-env.mjs --env staging     # a real project's map (default: production)
 *   node tools/flags/write-functions-env.mjs --project demo-creativo-test
 *   FLAGS_ENV=staging firebase deploy --only functions --project <staging-id>
 *
 * The files land in dist/apps/functions/, the deployed `functions.source`,
 * so this runs AFTER `pnpm nx build functions` (the build wipes the folder):
 *   .env.<projectId>  the chosen map, one `PARAM=true|false` line per flag;
 *   .env.local        the development map; the CLI loads it only when emulating;
 *   .secret.local     a demo-* project only: a fixed TEST value for every
 *                     secret the functions bind (`EMULATOR_SECRETS`) — the
 *                     CLI reads it only when emulating, `firebase.json`
 *                     never deploys it, and a real project's values live in
 *                     Secret Manager (`firebase functions:secrets:set`).
 *
 * Which map: a demo-* project, or none, only ever gets `development`. A real
 * project gets --env / FLAGS_ENV, else `production` — the map that switches
 * features on last, so a forgotten argument leaves a feature dark, not lit.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = resolve(here, '..', '..');
export const MANIFEST_PATH = join(WORKSPACE_ROOT, 'config/feature-flags.json');
export const FUNCTIONS_DIST = join(WORKSPACE_ROOT, 'dist/apps/functions');

export const ENVIRONMENTS = ['development', 'staging', 'production'];
const DEPLOYABLE = ['staging', 'production'];

/** Same shape the domain's keys follow: dotted, camelCase segments. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
/** The CLI refuses these in any .env (firebase-tools functions/env.js). */
const RESERVED_PREFIXES = ['X_GOOGLE_', 'FIREBASE_', 'EXT_'];

/** `loyalty.selfView` → `LOYALTY_SELF_VIEW`, the name `defineBoolean` reads. */
export function paramNameOf(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('.', '_')
    .toUpperCase();
}

/**
 * Every problem at once, as sentences. The domain parse (`FeatureFlags`)
 * knows which keys exist; this knows the file's shape, and that the maps
 * agree, so no environment silently lacks a flag.
 */
export function manifestErrors(manifest) {
  if (!isPlainObject(manifest)) return ['the manifest is not a JSON object'];
  const errors = [];
  const envs = Object.keys(manifest);
  for (const env of envs) {
    if (!ENVIRONMENTS.includes(env))
      errors.push(`unknown environment "${env}"`);
  }
  for (const env of ENVIRONMENTS) {
    if (!(env in manifest)) errors.push(`missing environment "${env}"`);
    else if (!isPlainObject(manifest[env]))
      errors.push(`"${env}" is not an object`);
  }
  if (errors.length > 0) return errors;

  const reference = Object.keys(manifest.development);
  for (const env of ENVIRONMENTS) {
    const map = manifest[env];
    for (const [key, value] of Object.entries(map)) {
      if (!KEY_PATTERN.test(key))
        errors.push(`${env}: "${key}" is not a dotted flag key`);
      else if (RESERVED_PREFIXES.some((p) => paramNameOf(key).startsWith(p)))
        errors.push(`${env}: "${key}" maps to a reserved env name`);
      if (typeof value !== 'boolean')
        errors.push(`${env}: "${key}" must be true or false`);
      if (!reference.includes(key))
        errors.push(`${env}: "${key}" is missing from development`);
    }
    for (const key of reference) {
      if (!(key in map)) errors.push(`${env}: "${key}" is missing`);
    }
  }
  return errors;
}

/**
 * The emulator's secret values (`.secret.local`) — one fixed, public TEST
 * value per secret the functions bind, so an emulated function never asks
 * Secret Manager: the key walk-in record ids are keyed by (OR-26,
 * `WALKIN_ID_KEY`) and the key a callable's outcome line digests its input
 * under (audit-hardening WS-4.2, `LOG_DIGEST_KEY`), both bound in
 * `apps/functions/src/main.ts`. Never a real key.
 */
export const EMULATOR_SECRETS = Object.freeze({
  WALKIN_ID_KEY: 'emulator-walkin-id-key-not-secret',
  LOG_DIGEST_KEY: 'emulator-log-digest-key-not-secret',
});

export function isDemoProject(projectId) {
  return !projectId || projectId.startsWith('demo-');
}

/** Throws on a request that could light a real project with the wrong map. */
export function chooseEnvironment({ projectId, requested }) {
  if (isDemoProject(projectId)) return 'development';
  if (requested === undefined || requested === '') return 'production';
  if (!DEPLOYABLE.includes(requested)) {
    throw new Error(
      `--env must be ${DEPLOYABLE.join(' or ')} for project "${projectId}" (got "${requested}")`,
    );
  }
  return requested;
}

export function renderEnv(map, environment) {
  const lines = Object.entries(map).map(
    ([key, value]) => `${paramNameOf(key)}=${value}`,
  );
  return [
    `# Generated from config/feature-flags.json (${environment}) by tools/flags/write-functions-env.mjs. Do not edit.`,
    ...lines,
    '',
  ].join('\n');
}

export function renderSecrets(secrets) {
  return [
    '# Emulator-only TEST secrets, written by tools/flags/write-functions-env.mjs. Never deployed; do not edit.',
    ...Object.entries(secrets).map(([name, value]) => `${name}=${value}`),
    '',
  ].join('\n');
}

/** Returns what it wrote; throws before writing anything when the input is bad. */
export function writeFunctionsEnv({ manifest, projectId, requested, outDir }) {
  const errors = manifestErrors(manifest);
  if (errors.length > 0) {
    throw new Error(`config/feature-flags.json: ${errors.join('; ')}`);
  }
  const environment = chooseEnvironment({ projectId, requested });
  if (!existsSync(outDir)) {
    throw new Error(
      `${outDir} does not exist; run \`pnpm nx build functions\` first`,
    );
  }

  const files = [];
  if (projectId) {
    const path = join(outDir, `.env.${projectId}`);
    writeFileSync(path, renderEnv(manifest[environment], environment));
    files.push(path);
  }
  const local = join(outDir, '.env.local');
  writeFileSync(local, renderEnv(manifest.development, 'development'));
  files.push(local);
  // The emulator's secrets — only for a project that can only ever be
  // emulated (an explicit demo-*), never beside a real project's build.
  if (projectId && projectId.startsWith('demo-')) {
    const secrets = join(outDir, '.secret.local');
    writeFileSync(secrets, renderSecrets(EMULATOR_SECRETS));
    files.push(secrets);
  }
  return { environment, files };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const projectId =
    argValue(argv, '--project') ?? process.env['GCLOUD_PROJECT'] ?? '';
  const requested = argValue(argv, '--env') ?? process.env['FLAGS_ENV'];
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const { environment, files } = writeFunctionsEnv({
    manifest,
    projectId,
    requested,
    outDir: FUNCTIONS_DIST,
  });
  console.log(
    `flags: ${environment} map → ${files.map((f) => relative(WORKSPACE_ROOT, f)).join(', ')}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(`flags: ${error.message}`);
    process.exit(1);
  }
}
