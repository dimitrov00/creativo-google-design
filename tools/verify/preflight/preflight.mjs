#!/usr/bin/env node
// Guard: the production preflight (owner ruling OR-35, DEP-F26) — a
// read-only proof that a hosted Firebase project is ready for a deploy, run
// by hand and as the hosting and functions predeploy of firebase.json.
//
//   pnpm run preflight --project <id> [--scope web|functions]
//   node tools/verify/preflight/preflight.mjs [--project <id>] [--scope web|functions] [--dist=dist/apps/web/browser] [--config=firebase.json]
//
// One PASS/FAIL row per check (runbook §3):
//
//   P1  `locations/<TenantConfig.DEFAULT.defaultLocationId>` exists, the
//       read guard admits it (`StoredDocumentSystem.admit` over the real
//       registry), and `ZonedTimeSystem.checkZone` — the `TimeZone` smart
//       constructor (F-2) — accepts its `timeZone`, stored canonical;
//   P2  every `purgeAt` TTL policy firestore.indexes.json declares (the
//       seven of runbook §2.1) is ACTIVE;
//   P3  every composite firestore.indexes.json declares is READY; an index
//       the project holds and the file does not is listed as INFO, a prune
//       candidate (runbook §3 step 6);
//   P4  the built bundle carries no REPLACE_ME and names the project id;
//   P5  the CSP's connect-src names the project's callables host, the only
//       one;
//   P6  no emulator variable is set, and the project is neither the
//       placeholder nor a demo-* one.
//
// `--scope web` (the default; the hosting predeploy) runs all six,
// `--scope functions` (the functions predeploy) P1–P3 and P6. The project is
// `--project`, else $GCLOUD_PROJECT (the Firebase CLI sets it for a
// predeploy), else `.firebaserc`'s default. When P6 fails, P1–P3 never read
// (SKIP): the read would reach an emulator, or a project nobody deploys to.
//
// Reads only. P1 reads through firebase-admin under the application-default
// credentials; P2 and P3 list through the Firestore Admin REST API with the
// same credentials' token, the project named as the quota project
// (`gcloud auth application-default login` first; runbook §3). The domain is
// the production TypeScript, bundled by `tools/seed/load-domain.mjs` — never
// a second copy of the default id, the read guard or the zone check.
//
// Exits 1 when a check does not pass (the CLI then stops the deploy), 2 on
// unreadable arguments. `CREATIVO_SKIP_PREFLIGHT=1` runs no check, warns
// loudly and exits 0 — the escape hatch, never a habit. The checks are pure
// functions over what was read, exported for preflight.spec.mjs.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSeedDomain } from '../../seed/load-domain.mjs';
import {
  CSP_HEADER,
  functionsHost,
  headerOf,
  parsePolicy,
  webHosting,
} from '../csp/check-csp.mjs';

/** A row's verdict: proven, disproven, or not read because P6 failed. */
export const Verdict = { Pass: 'PASS', Fail: 'FAIL', Skip: 'SKIP' };

/** What each check proves — the table's third column. */
export const CHECKS = {
  P1: 'the default location exists, admitted, on a valid IANA zone',
  P2: 'every declared purgeAt TTL policy is ACTIVE',
  P3: 'every declared composite index is READY',
  P4: 'the built bundle has no REPLACE_ME and names the project',
  P5: "connect-src names the project's callables host",
  P6: 'no emulator variable; a real project',
};

/** The checks each predeploy runs (firebase.json). */
export const SCOPES = {
  web: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
  functions: ['P1', 'P2', 'P3', 'P6'],
};

/** The checks that read the hosted project — never run when P6 fails. */
const READS_PROJECT = ['P1', 'P2', 'P3'];

/** The checks that need a project id to compare against. */
const NAMES_PROJECT = ['P4', 'P5'];

/** The placeholder spellings the repository ships with (`.firebaserc`, the environment files). */
const PLACEHOLDER = /REPLACE_ME|replace-me/;

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens, a letter first, no hyphen last. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** An emulator switch (`FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FUNCTIONS_EMULATOR`, …). */
const EMULATOR_VARIABLE = /EMULATOR/;

/** The Firestore Admin REST API. */
const FIRESTORE_ADMIN = 'https://firestore.googleapis.com/v1';

/** A listing that takes longer than this is a failed read, not a hung deploy. */
const READ_TIMEOUT_MS = 30_000;

/** The TTL state a policy deletes in; the hint for the others (runbook §2.3). */
const TTL_ACTIVE = 'ACTIVE';
const TTL_HINTS = {
  CREATING: 'the TTL service is still applying it — wait and run again',
  NEEDS_REPAIR:
    'it failed to apply — re-apply that group with runbook §2.2’s fallback (--disable-ttl, then --enable-ttl)',
};

/** The index state a query may use; the hint for the others. */
const INDEX_READY = 'READY';
const INDEX_HINTS = {
  CREATING: 'still building — wait and run again',
  NEEDS_REPAIR:
    'the build failed — delete it and deploy firestore:indexes again',
};

/** A failed project read the credentials explain — and the line it then carries. */
const CREDENTIALS_FAILURE =
  /credential|permission|UNAUTHENTICATED|HTTP 40[13]\b/i;
const CREDENTIALS_HINT =
  'application-default credentials: gcloud auth application-default login (runbook §3)';

const USAGE =
  'usage: node tools/verify/preflight/preflight.mjs [--project <id>] [--scope web|functions] [--dist=<dir>] [--config=<firebase.json>]';

function row(check, verdict, detail, lines = []) {
  return { check, verdict, detail, lines };
}

/** `{ errorCode: 'TIME_INVALID_TIME_ZONE', rawZone: 'Mars/Olympus' }` → `TIME_INVALID_TIME_ZONE rawZone="Mars/Olympus"`. */
function describeError(error) {
  return Object.entries(error)
    .map(([field, value]) =>
      field === 'errorCode' ? value : `${field}=${JSON.stringify(value)}`,
    )
    .join(' ');
}

/**
 * P6 — the environment is a production deploy's: no emulator variable (a
 * firebase-admin read would go to the emulator), and the project is a real
 * one — not missing, not the placeholder, not a `demo-*` project (the
 * emulators' own), and shaped like a Google Cloud project id.
 */
export function checkEnvironment({ env, projectId }) {
  const problems = [];
  for (const name of Object.keys(env).sort()) {
    if (EMULATOR_VARIABLE.test(name) && env[name]) {
      problems.push(`${name} is set — unset every emulator variable first`);
    }
  }
  if (!projectId) {
    problems.push(
      'no project — pass --project <id>, or deploy with the Firebase CLI ($GCLOUD_PROJECT)',
    );
  } else if (PLACEHOLDER.test(projectId)) {
    problems.push(
      `${projectId} is the placeholder — set the real project id (.firebaserc, runbook §2.2)`,
    );
  } else if (projectId.startsWith('demo-')) {
    problems.push(`${projectId} is a demo project — the emulators' only`);
  } else if (!PROJECT_ID.test(projectId)) {
    problems.push(`${projectId} is not a Google Cloud project id`);
  }
  return problems.length === 0
    ? row('P6', Verdict.Pass, `no emulator variable; ${projectId}`)
    : row('P6', Verdict.Fail, 'not a production deploy', problems);
}

/**
 * P1 — the deployment's default location (`TenantConfig.DEFAULT`), as
 * read (`stored`: its id beside its body, or `null` when absent), through
 * the domain the seed bundle hands out: the read guard's one dispatch, then
 * the zone's smart constructor. The stored spelling must be the canonical
 * one, because every reader uses the stored zone as it is
 * (`ShopZoneSystem.zoneOf`).
 */
export function checkDefaultLocation({ domain, stored }) {
  const { Collections, StoredDocumentSystem, TenantConfig, ZonedTimeSystem } =
    domain;
  const path = `${Collections.Locations}/${TenantConfig.DEFAULT.defaultLocationId}`;
  if (stored === null) {
    return row('P1', Verdict.Fail, `${path} does not exist`, [
      'every boundary with no shop in scope reads its zone there — create it with an IANA timeZone (runbook §3)',
    ]);
  }
  const admitted = StoredDocumentSystem.admit(
    StoredDocumentSystem.guardOf,
    Collections.Locations,
    stored,
  );
  if (!admitted.ok) {
    return row('P1', Verdict.Fail, `${path} is refused by the read guard`, [
      describeError(admitted.error),
    ]);
  }
  const raw = admitted.value.timeZone;
  if (typeof raw !== 'string') {
    return row('P1', Verdict.Fail, `${path} holds no timeZone`);
  }
  const zone = ZonedTimeSystem.checkZone(raw);
  if (!zone.ok) {
    return row('P1', Verdict.Fail, `${path}: timeZone "${raw}" is refused`, [
      describeError(zone.error),
    ]);
  }
  if (zone.value !== raw) {
    return row(
      'P1',
      Verdict.Fail,
      `${path}: timeZone "${raw}" is not the canonical spelling`,
      [`store "${zone.value}" — the readers use the stored zone as it is`],
    );
  }
  return row('P1', Verdict.Pass, `${path}: timeZone ${raw}`);
}

/** `projects/p/databases/(default)/collectionGroups/otps/fields/purgeAt` → `otps/purgeAt`. */
export function fieldKeyOf(name) {
  const match = /\/collectionGroups\/([^/]+)\/fields\/([^/]+)$/.exec(name);
  return match === null ? name : `${match[1]}/${match[2]}`;
}

/**
 * P2 — every `fieldOverrides` entry with `ttl: true` (`declared`, the
 * parsed firestore.indexes.json) holds an ACTIVE policy among the
 * project's TTL fields (`listed`, the REST listing's `fields`). A policy
 * the file does not declare is INFO.
 */
export function checkTtlPolicies({ declared, listed }) {
  const wanted = (declared.fieldOverrides ?? [])
    .filter((override) => override.ttl === true)
    .map((override) => `${override.collectionGroup}/${override.fieldPath}`);
  if (wanted.length === 0) {
    return row(
      'P2',
      Verdict.Fail,
      'firestore.indexes.json declares no TTL policy',
    );
  }
  const states = new Map(
    listed
      .filter((field) => field.ttlConfig !== undefined)
      .map((field) => [
        fieldKeyOf(field.name),
        field.ttlConfig.state ?? 'UNSPECIFIED',
      ]),
  );
  const lines = [];
  for (const key of wanted) {
    const state = states.get(key);
    if (state === undefined) {
      lines.push(
        `${key} has no TTL policy — never deployed: firebase deploy --only firestore:indexes`,
      );
    } else if (state !== TTL_ACTIVE) {
      const hint = TTL_HINTS[state];
      lines.push(`${key} is ${state}${hint ? ` — ${hint}` : ''}`);
    }
  }
  const failing = lines.length;
  for (const [key, state] of states) {
    if (!wanted.includes(key)) {
      lines.push(`INFO  ${key} (${state}) is not in firestore.indexes.json`);
    }
  }
  return row(
    'P2',
    failing === 0 ? Verdict.Pass : Verdict.Fail,
    `${wanted.length - failing} of ${wanted.length} TTL policies ACTIVE`,
    lines,
  );
}

/** A listed index's collection group, from its resource name. */
function collectionGroupOf(index) {
  return (
    /\/collectionGroups\/([^/]+)\/indexes\//.exec(index.name ?? '')?.[1] ??
    index.collectionGroup
  );
}

/** An index's fields without the `__name__` tiebreak Firestore appends to every composite. */
function keyFieldsOf(index) {
  const fields = index.fields ?? [];
  return fields.at(-1)?.fieldPath === '__name__' ? fields.slice(0, -1) : fields;
}

/** A field as one comparable word: its path and how it is indexed. */
function fieldWordOf(field) {
  if (field.order) {
    return `${field.fieldPath} ${field.order === 'DESCENDING' ? 'desc' : 'asc'}`;
  }
  if (field.arrayConfig) return `${field.fieldPath} contains`;
  return `${field.fieldPath} ${JSON.stringify(field.vectorConfig ?? null)}`;
}

/** `appointments: busyKeys contains, bookingStatus asc, utcEpochMs asc` — `(group)` for a collection-group scope. */
function indexLabelOf(index) {
  const scope =
    (index.queryScope ?? 'COLLECTION') === 'COLLECTION' ? '' : ' (group)';
  const fields = keyFieldsOf(index).map(fieldWordOf).join(', ');
  return `${collectionGroupOf(index)}${scope}: ${fields}`;
}

/** Whether a listed index is the one a declared entry deploys (as the CLI matches them). */
export function sameIndex(listed, spec) {
  return indexLabelOf(listed) === indexLabelOf(spec);
}

/**
 * P3 — every composite `declared` (the parsed firestore.indexes.json)
 * names is READY among the project's composites (`listed`, the REST
 * listing's `indexes`). One the project holds and the file does not is
 * INFO: a prune candidate (pass B's deleted #1, #3 and #9 on a project
 * deployed from an older tree, OR-36).
 */
export function checkComposites({ declared, listed }) {
  const wanted = declared.indexes ?? [];
  const lines = [];
  for (const spec of wanted) {
    const match = listed.find((index) => sameIndex(index, spec));
    if (match === undefined) {
      lines.push(
        `${indexLabelOf(spec)} — not deployed: firebase deploy --only firestore:indexes`,
      );
    } else if (match.state !== INDEX_READY) {
      const hint = INDEX_HINTS[match.state];
      lines.push(
        `${indexLabelOf(spec)} is ${match.state}${hint ? ` — ${hint}` : ''}`,
      );
    }
  }
  const failing = lines.length;
  for (const index of listed) {
    if (!wanted.some((spec) => sameIndex(index, spec))) {
      lines.push(
        `INFO  not in firestore.indexes.json, a prune candidate (runbook §3 step 6): ${indexLabelOf(index)}`,
      );
    }
  }
  return row(
    'P3',
    failing === 0 ? Verdict.Pass : Verdict.Fail,
    `${wanted.length - failing} of ${wanted.length} composites READY`,
    lines,
  );
}

/**
 * P4 — the built scripts (`scripts`: `{ path, text }` for every `.js` file
 * under `dist`) carry no placeholder, and at least one names the project id
 * as a string literal (the environment's `firebase.projectId`).
 */
export function checkBundle({ dist, scripts, projectId }) {
  if (scripts.length === 0) {
    return row('P4', Verdict.Fail, `no built scripts under ${dist}`, [
      'build the site first: pnpm nx build web',
    ]);
  }
  const lines = [];
  for (const { path, text } of scripts) {
    if (PLACEHOLDER.test(text)) {
      lines.push(
        `${path} carries REPLACE_ME — fill apps/web/src/environments/environment.production.ts`,
      );
    }
  }
  const literals = [`"${projectId}"`, `'${projectId}'`, `\`${projectId}\``];
  if (
    !scripts.some(({ text }) =>
      literals.some((literal) => text.includes(literal)),
    )
  ) {
    lines.push(
      `no script names "${projectId}" — environment.production.ts's firebase.projectId is another project's`,
    );
  }
  return lines.length === 0
    ? row(
        'P4',
        Verdict.Pass,
        `${scripts.length} scripts under ${dist}: no REPLACE_ME, names ${projectId}`,
      )
    : row(
        'P4',
        Verdict.Fail,
        `the build under ${dist} is not this project's`,
        lines,
      );
}

/**
 * P5 — the web site's policy (firebase.json's `**` rule) lets the page
 * reach the project's callables, and no other project's: its connect-src
 * names exactly one cloudfunctions.net host, this project's.
 */
export function checkConnectSrc({ config, projectId }) {
  const host = functionsHost(projectId);
  const all = webHosting(config)?.headers?.find((rule) => rule.source === '**');
  const policy = headerOf(all, CSP_HEADER);
  if (!policy) {
    return row(
      'P5',
      Verdict.Fail,
      'firebase.json serves the web site no Content-Security-Policy',
    );
  }
  const callables = (parsePolicy(policy).get('connect-src') ?? []).filter(
    (source) => source.includes('cloudfunctions.net'),
  );
  return callables.length === 1 && callables[0] === host
    ? row('P5', Verdict.Pass, `connect-src names ${host}`)
    : row('P5', Verdict.Fail, `connect-src must name exactly ${host}`, [
        `it names ${callables.join(' ') || 'no callables host'} — edit firebase.json's policy and .firebaserc's default, then pnpm run verify:csp`,
      ]);
}

/**
 * Every check of `scope`, over what `read` answers: `domain()` (the seed
 * bundle), `location(domain)` (the default location as stored, or `null`),
 * `declared()` (firestore.indexes.json), `ttlFields()` and `indexes()` (the
 * project's listings), `bundle()` (`{ dist, scripts }`) and `config()`
 * (firebase.json). A read that throws fails its check; P6 runs first and,
 * failing, keeps P1–P3 from reading at all.
 */
export async function runPreflight({ scope, projectId, env, read }) {
  const environment = checkEnvironment({ env, projectId });
  const jobs = {
    P1: async () => {
      const domain = await read.domain();
      return checkDefaultLocation({
        domain,
        stored: await read.location(domain),
      });
    },
    P2: async () =>
      checkTtlPolicies({
        declared: await read.declared(),
        listed: await read.ttlFields(),
      }),
    P3: async () =>
      checkComposites({
        declared: await read.declared(),
        listed: await read.indexes(),
      }),
    P4: async () => checkBundle({ ...(await read.bundle()), projectId }),
    P5: async () => checkConnectSrc({ config: await read.config(), projectId }),
    P6: async () => environment,
  };
  return Promise.all(
    SCOPES[scope].map(async (check) => {
      if (
        READS_PROJECT.includes(check) &&
        environment.verdict !== Verdict.Pass
      ) {
        return row(check, Verdict.Skip, 'not read — P6 failed');
      }
      if (NAMES_PROJECT.includes(check) && !projectId) {
        return row(check, Verdict.Skip, 'no project to compare against');
      }
      try {
        return await jobs[check]();
      } catch (error) {
        return row(
          check,
          Verdict.Fail,
          `cannot read: ${error.message}`,
          READS_PROJECT.includes(check) &&
            CREDENTIALS_FAILURE.test(error.message)
            ? [CREDENTIALS_HINT]
            : [],
        );
      }
    }),
  );
}

/** 0 when every row passed, 1 otherwise — a SKIP is no proof. */
export function exitCodeOf(rows) {
  return rows.every((entry) => entry.verdict === Verdict.Pass) ? 0 : 1;
}

/** The PASS/FAIL table, its INFO and failure lines under their row, and the verdict line. */
export function renderTable({ projectId, scope, rows }) {
  const out = [
    `Production preflight — project ${projectId || '(none)'}, scope ${scope} (${SCOPES[scope].join(' ')})`,
    '',
    `  ${'CHECK'.padEnd(5)}  ${'RESULT'.padEnd(6)}  WHAT IT PROVES`,
  ];
  const indent = ' '.repeat(17);
  for (const entry of rows) {
    out.push(
      `  ${entry.check.padEnd(5)}  ${entry.verdict.padEnd(6)}  ${CHECKS[entry.check]}`,
    );
    out.push(`${indent}${entry.detail}`);
    for (const line of entry.lines) out.push(`${indent}  ${line}`);
  }
  const failed = rows.filter((entry) => entry.verdict !== Verdict.Pass);
  out.push(
    '',
    failed.length === 0
      ? `PASS — ${rows.length} of ${rows.length} checks passed`
      : `FAIL — ${failed.map((entry) => entry.check).join(', ')} did not pass; the deploy stops here (runbook §3)`,
  );
  return out.join('\n');
}

/** The banner the escape hatch prints instead of the table. */
export function skipBanner({ projectId, scope }) {
  const bar = '!'.repeat(78);
  return [
    bar,
    `!!! CREATIVO_SKIP_PREFLIGHT=1 — the production preflight did NOT run (scope ${scope}, ${SCOPES[scope].join(' ')}).`,
    `!!! Nothing proved the default location, the TTL policies, the indexes, the bundle,`,
    `!!! the CSP or the environment of ${projectId || '(no project)'}. Run \`pnpm run preflight\` after this deploy.`,
    bar,
  ].join('\n');
}

/**
 * The scope and the project from the command line: `--scope` (default
 * `web`), `--project`, else `$GCLOUD_PROJECT`, else `firebasercDefault()`.
 * Throws on an unknown option or scope.
 */
export function optionsOf(args, env, firebasercDefault) {
  const { values } = parseArgs({
    args,
    options: {
      scope: { type: 'string', default: 'web' },
      project: { type: 'string' },
      dist: { type: 'string', default: 'dist/apps/web/browser' },
      config: { type: 'string', default: 'firebase.json' },
    },
    strict: true,
  });
  if (!Object.hasOwn(SCOPES, values.scope)) {
    throw new Error(
      `unknown scope "${values.scope}" — one of ${Object.keys(SCOPES).join(', ')}`,
    );
  }
  return {
    scope: values.scope,
    projectId:
      values.project || env.GCLOUD_PROJECT || firebasercDefault() || null,
    dist: values.dist,
    config: values.config,
  };
}

/**
 * The preflight as a command: the options, the escape hatch, the checks,
 * the table. Answers the exit code.
 */
export async function preflight({
  args,
  env,
  readersFor,
  firebasercDefault,
  print,
  warn,
}) {
  let options;
  try {
    options = optionsOf(args, env, firebasercDefault);
  } catch (error) {
    warn(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (env.CREATIVO_SKIP_PREFLIGHT === '1') {
    warn(skipBanner(options));
    return 0;
  }
  const rows = await runPreflight({
    scope: options.scope,
    projectId: options.projectId,
    env,
    read: readersFor(options),
  });
  print(renderTable({ ...options, rows }));
  return exitCodeOf(rows);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Every `.js` / `.mjs` file under `dir`, as `{ path, text }` (`path` relative to the working directory). */
function scriptsUnder(dir) {
  const scripts = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.m?js$/.test(name)) {
        scripts.push({
          path: relative(process.cwd(), full),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(dir);
  return scripts;
}

/** Calls `load` once and hands every caller the same promise. */
function once(load) {
  let pending;
  return () => (pending ??= load());
}

/**
 * The live reads for `options`: the files on disk, the default location
 * through firebase-admin, and the two listings through the Firestore Admin
 * REST API — all under the one application-default credential. firebase-admin
 * loads only when a project read runs.
 */
function liveReaders({ projectId, dist, config }) {
  const configPath = resolve(config);
  const firebaseConfig = once(async () => readJson(configPath));
  const credential = once(async () => {
    const { applicationDefault } = await import('firebase-admin/app');
    return applicationDefault();
  });

  /** Every item of a paged Admin listing (`key`: `indexes` or `fields`). */
  async function listAll(path, key, filter) {
    const { access_token: token } = await (await credential()).getAccessToken();
    const items = [];
    let pageToken = '';
    do {
      const url = new URL(
        `${FIRESTORE_ADMIN}/projects/${projectId}/databases/(default)/${path}`,
      );
      if (filter) url.searchParams.set('filter', filter);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-goog-user-project': projectId,
        },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `${path}: HTTP ${response.status}${body.error?.message ? ` — ${body.error.message}` : ''}`,
        );
      }
      items.push(...(body[key] ?? []));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return items;
  }

  return {
    domain: once(loadSeedDomain),
    location: async (domain) => {
      const { deleteApp, initializeApp } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      const app = initializeApp(
        { credential: await credential(), projectId },
        'creativo-preflight',
      );
      try {
        const snap = await getFirestore(app)
          .collection(domain.Collections.Locations)
          .doc(domain.TenantConfig.DEFAULT.defaultLocationId)
          .get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
      } finally {
        await deleteApp(app);
      }
    },
    declared: once(async () =>
      readJson(
        resolve(
          dirname(configPath),
          (await firebaseConfig()).firestore?.indexes ??
            'firestore.indexes.json',
        ),
      ),
    ),
    ttlFields: () =>
      listAll('collectionGroups/-/fields', 'fields', 'ttlConfig:*'),
    indexes: () => listAll('collectionGroups/-/indexes', 'indexes'),
    bundle: async () => {
      const dir = resolve(dist);
      return {
        dist: relative(process.cwd(), dir) || dir,
        scripts: existsSync(dir) ? scriptsUnder(dir) : [],
      };
    },
    config: firebaseConfig,
  };
}

/** `.firebaserc`'s default project, or `null` when there is none to read. */
function firebasercDefault() {
  const path = resolve('.firebaserc');
  if (!existsSync(path)) return null;
  try {
    return readJson(path).projects?.default ?? null;
  } catch {
    return null;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await preflight({
    args: process.argv.slice(2),
    env: process.env,
    readersFor: liveReaders,
    firebasercDefault,
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
