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
//       placeholder nor a demo-* one;
//   P7  no deployed project can construct an emulator-only adapter: every
//       use of a functions export tagged `@emulatorOnly` (the console OTP
//       sender, the fixed-code OTP crypto), followed through renames and
//       re-exports, sits behind `onEmulator()`;
//   P8  no launch-blocker stand-in is wired: no functions export
//       tagged `@launchBlocker` is used anywhere, followed as P7 follows
//       its tag — today the deployed branch wires `refusingOtpSender`, which
//       refuses every sign-in (the launch blocker of
//       docs/production-deploy.md §1), so P8 fails by design.
//
// `--scope web` (the default; the hosting predeploy) runs P1–P6,
// `--scope functions` (the functions predeploy) P1–P3 and P6–P8. The
// project is `--project`, else $GCLOUD_PROJECT (the Firebase CLI sets it for
// a predeploy), else `.firebaserc`'s default. When P6 fails, P1–P3 never
// read (SKIP): the read would reach an emulator, or a project nobody deploys
// to.
//
// Reads only. P1 reads through firebase-admin under the application-default
// credentials; P2 and P3 list through the Firestore Admin REST API with the
// same credentials' token, the project named as the quota project
// (`gcloud auth application-default login` first; runbook §3); P7 and P8
// read no project: they resolve names across the files of
// apps/functions/src that tsconfig.app.json builds, in memory, with the
// TypeScript compiler. The
// domain is the production TypeScript, bundled by
// `tools/seed/load-domain.mjs` — never a second copy of the default id, the
// read guard or the zone check.
//
// Exits 1 when a check does not pass (the CLI then stops the deploy), 2 on
// unreadable arguments. `CREATIVO_SKIP_PREFLIGHT=1` runs no check, warns
// loudly and exits 0 — the escape hatch, never a habit. The checks are pure
// functions over what was read, exported for preflight.spec.mjs.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
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
  P7: 'the emulator-only adapters run only behind onEmulator()',
  P8: 'no launch-blocker stand-in is wired (@launchBlocker)',
};

/** What each check proves something about — the escape hatch names what went unproven. */
const SUBJECTS = {
  P1: 'the default location',
  P2: 'the TTL policies',
  P3: 'the indexes',
  P4: 'the bundle',
  P5: 'the CSP',
  P6: 'the environment',
  P7: 'the emulator-only adapters',
  P8: 'the launch blockers',
};

/** The checks each predeploy runs (firebase.json). */
export const SCOPES = {
  web: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
  functions: ['P1', 'P2', 'P3', 'P6', 'P7', 'P8'],
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

/** The functions' source, and — relative to it — the files tsconfig.app.json leaves out of the build. */
const FUNCTIONS_SOURCE = 'apps/functions/src';
const NOT_BUILT = /\.(spec|test)\.ts$|^test-support\//;

/** The JSDoc tag that marks a functions export as the emulator's alone (the console OTP sender, the fixed OTP code). */
const EMULATOR_ONLY_TAG = 'emulatorOnly';

/** The composition root's emulator switch — the one gate an emulator-only export may sit behind. */
const EMULATOR_GATE = 'onEmulator';

/** The JSDoc tag that marks a functions export a launch must replace (the refusing OTP sender) — P8 fails while one is used. */
const LAUNCH_BLOCKER_TAG = 'launchBlocker';

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

/** P7's way out: the shape the OTP crypto already has, and the OTP sender's checklist item. */
const EMULATOR_ONLY_HINT = `wire a deployed adapter beside it — ${EMULATOR_GATE}() ? <emulator adapter> : <deployed adapter>, as the OTP crypto is; the OTP sender's is the launch blocker of docs/production-deploy.md §1, "Sign-in: the OTP sender"`;

/** P8's way out: the checklist item that replaces the refusing sender. */
const LAUNCH_BLOCKER_HINT = `replace each use with the real adapter — the deployed OTP sender is the launch blocker of docs/production-deploy.md §1, "Sign-in: the OTP sender"`;

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

/** Whether `expression`, parentheses aside, is the bare `onEmulator()` call. */
function isEmulatorGate(expression) {
  let call = expression;
  while (ts.isParenthesizedExpression(call)) call = call.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === EMULATOR_GATE &&
    call.arguments.length === 0
  );
}

/** Whether `node` sits in the true branch of `onEmulator() ? … : …` or the then-block of `if (onEmulator())`. */
function behindEmulatorGate(node) {
  for (let child = node; child.parent; child = child.parent) {
    const { parent } = child;
    if (
      ts.isConditionalExpression(parent) &&
      parent.whenTrue === child &&
      isEmulatorGate(parent.condition)
    ) {
      return true;
    }
    if (
      ts.isIfStatement(parent) &&
      parent.thenStatement === child &&
      isEmulatorGate(parent.expression)
    ) {
      return true;
    }
  }
  return false;
}

/** Whether the identifier `node` names a binding — a declaration, an import, an export — rather than using a value. */
function isBindingName(node) {
  const { parent } = node;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isExportAssignment(parent) ||
    ((ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyAssignment(parent)) &&
      parent.name === node)
  );
}

/**
 * Whether `node` sits in a type (`typeof x`, `ReturnType<typeof x>`), a
 * position that constructs nothing — a heritage clause's expression
 * (`extends make()`) is a value, though the syntax files it as a type.
 */
function inTypePosition(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isExpressionWithTypeArguments(parent)) return false;
    if (ts.isTypeNode(parent)) return true;
  }
  return false;
}

/**
 * The functions' source as one in-memory program: every file of `sources`
 * under a virtual `/`, relative imports resolved between them, everything
 * else (`@core/*`, the SDKs, the lib) left unresolved — the checker only has
 * to follow a name from its use back to its declaration inside the app.
 * Answers the program and `resolve(specifier, fromFile)`, the file a
 * module specifier names.
 */
function programOver(sources) {
  const files = new Map(
    sources.map(({ path, text }) => [posix.resolve('/', path), text]),
  );
  const directories = new Set(
    [...files.keys()].flatMap((name) =>
      name
        .split('/')
        .slice(1, -1)
        .map((_, depth, parts) => `/${parts.slice(0, depth + 1).join('/')}`),
    ),
  );
  const host = {
    getSourceFile: (name, target) =>
      files.has(name)
        ? ts.createSourceFile(name, files.get(name), target, true)
        : undefined,
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    directoryExists: (name) => name === '/' || directories.has(name),
    getDirectories: () => [],
  };
  const options = {
    noLib: true,
    types: [],
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  return {
    program: ts.createProgram([...files.keys()], options, host),
    resolve: (specifier, fromFile) =>
      ts.resolveModuleName(specifier, fromFile, options, host).resolvedModule
        ?.resolvedFileName,
  };
}

/**
 * The run-time load `node` is — `import(…)` or `require(…)` — as
 * `{ specifier }`, the specifier `undefined` when it is not a literal; or
 * `undefined` for any other node.
 */
function runtimeLoadOf(node) {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return undefined;
  }
  const callee = node.expression;
  if (
    callee.kind !== ts.SyntaxKind.ImportKeyword &&
    !(ts.isIdentifier(callee) && callee.text === 'require')
  ) {
    return undefined;
  }
  const [argument] = node.arguments;
  return {
    specifier: ts.isStringLiteralLike(argument) ? argument.text : undefined,
  };
}

/** Every JSDoc tag on `node`, from each of its doc blocks — `ts.getJSDocTags` reads only the last. */
function docTagsOf(node) {
  return (node.jsDoc ?? []).flatMap((doc) => doc.tags ?? []);
}

/**
 * The uses, in the functions' source, of every export tagged `@<tag>` in
 * its JSDoc — the machinery P7 (`@emulatorOnly`) and P8 (`@launchBlocker`)
 * share. Over `sources` (`{ path, text }` for every file tsconfig.app.json
 * builds):
 *
 * - every use of such an export is followed by the TypeScript checker
 *   through renamed imports, re-exports and namespaces back to the tagged
 *   declaration, so a rename keeps the anchor. A use inside another
 *   declaration of the same tag is no use of its own: that one is judged
 *   where it is used in turn. A type position (`typeof consoleOtpSender`)
 *   constructs nothing and is no use;
 * - a run-time load (`import(…)`, `require(…)`) of a module that exports
 *   one, declared or re-exported, is a use at the load, since the checker
 *   cannot follow what it hands back; a load whose specifier is not a
 *   literal cannot be followed at all and is a use wherever it sits;
 * - a namespace of such a module (`import * as ns`) is followed member by
 *   member where a member is reached by name (`ns.name`, `ns['name']`);
 *   used any other way — as a whole (`Object.values(ns)`, `{ ...ns }`,
 *   `{ ns }`, a destructuring, `ns[key]`) — it is a use where it sits, since
 *   the checker cannot tell which export it reaches;
 * - the tag anchors only on an exported top-level `const` or `function`;
 *   anywhere else — a type, a record member, a default-exported expression,
 *   a declaration its module never exports (a line slipped in between the
 *   doc and the export) — it is a failure line, so a tag can never drop out
 *   unnoticed.
 *
 * Answers `{ names, lines, uses }`: the tagged exports' names; the failure
 * lines of tags that anchor nothing; and each use in file order as
 * `{ at, node, head, tail }` — its `path:line`, its node, and the words a
 * check composes around where it sits (`${at} ${head}<where>${tail}`).
 */
function taggedExportUses({ sources, tag, check }) {
  const { program, resolve: resolveModule } = programOver(sources);
  const checker = program.getTypeChecker();
  const pathOf = new Map(
    sources.map(({ path }) => [posix.resolve('/', path), path]),
  );
  const files = program
    .getSourceFiles()
    .filter((file) => pathOf.has(file.fileName));
  const lines = [];
  const uses = [];
  /** `path:line` of `node` in `file`. */
  const at = (file, node) =>
    `${pathOf.get(file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;

  /** Each file → the declarations its module exports, re-exports included. */
  const exported = new Map(
    files.map((file) => {
      const module = checker.getSymbolAtLocation(file);
      return [
        file.fileName,
        new Set(
          (module ? checker.getExportsOfModule(module) : [])
            .map((symbol) =>
              symbol.flags & ts.SymbolFlags.Alias
                ? checker.getAliasedSymbol(symbol)
                : symbol,
            )
            .flatMap((symbol) => symbol.declarations ?? []),
        ),
      ];
    }),
  );

  /** Each `@<tag>` declaration → its name and file; a failure line for each tag that anchors nothing. */
  const tagged = new Map();
  for (const file of files) {
    const collect = (node) => {
      if (docTagsOf(node).some((entry) => entry.tagName.text === tag)) {
        const declarations =
          node.parent !== file
            ? []
            : ts.isVariableStatement(node)
              ? node.declarationList.declarations
              : ts.isFunctionDeclaration(node) && node.name
                ? [node]
                : [];
        if (declarations.length === 0) {
          lines.push(
            `${at(file, node)} tags ${/^[AEIOU]/.test(ts.SyntaxKind[node.kind]) ? 'an' : 'a'} ${ts.SyntaxKind[node.kind]} @${tag} — the tag anchors only on an exported top-level const or function`,
          );
        }
        for (const declaration of declarations) {
          const name = ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : undefined;
          if (!name || !exported.get(file.fileName).has(declaration)) {
            lines.push(
              `${at(file, declaration)} tags ${name ?? 'a destructuring'} @${tag}, which its module does not export — move the tag onto the export`,
            );
          } else {
            tagged.set(declaration, {
              name,
              path: pathOf.get(file.fileName),
            });
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(file);
  }

  /** Each file whose module exports a tagged declaration → their names. */
  const taggedIn = new Map();
  for (const file of files) {
    const names = [...exported.get(file.fileName)]
      .filter((declaration) => tagged.has(declaration))
      .map((declaration) => tagged.get(declaration).name);
    if (names.length > 0) taggedIn.set(file.fileName, [...new Set(names)]);
  }

  /** The tagged declaration a use of `node` resolves to, if any. */
  const taggedOf = (node) => {
    let symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol?.declarations?.find((entry) =>
      tagged.has(entry),
    );
    return declaration ? tagged.get(declaration) : undefined;
  };

  /** The file of a module exporting a tagged declaration that the identifier `node` names as a namespace (`import * as ns`), if any. */
  const namespaceOf = (node) => {
    let symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const module = symbol?.declarations?.find(
      (entry) => ts.isSourceFile(entry) && taggedIn.has(entry.fileName),
    );
    return module?.fileName;
  };

  /** Whether the namespace `node` is only the object of a member reached by name (`ns.name`, `ns['name']`) — that member is judged instead. */
  const reachesByName = (node) => {
    const { parent } = node;
    return (
      (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
      (ts.isElementAccessExpression(parent) &&
        parent.expression === node &&
        ts.isStringLiteralLike(parent.argumentExpression))
    );
  };

  /** Whether `node` sits inside a tagged declaration — judged where that one is used. */
  const insideTagged = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (tagged.has(parent)) return true;
    }
    return false;
  };

  if (tagged.size > 0) {
    for (const file of files) {
      /** Records `node` as a use worded `head` … `tail`, unless a tagged declaration holds it. */
      const use = (node, head, tail = '') => {
        if (!insideTagged(node)) {
          uses.push({ at: at(file, node), node, head, tail });
        }
      };
      const visit = (node) => {
        const load = runtimeLoadOf(node);
        const loaded =
          load?.specifier === undefined
            ? undefined
            : resolveModule(load.specifier, file.fileName);
        if (load && load.specifier === undefined) {
          use(
            node,
            'loads a module named at run time',
            ` — ${check} cannot follow it; name it with a string literal`,
          );
        } else if (taggedIn.has(loaded)) {
          use(
            node,
            `loads ${pathOf.get(loaded)} (@${tag} ${taggedIn.get(loaded).join(', ')})`,
            ' — import it statically, so each use can be followed',
          );
        } else if (
          ts.isStringLiteralLike(node) &&
          ts.isElementAccessExpression(node.parent) &&
          node.parent.argumentExpression === node &&
          !inTypePosition(node)
        ) {
          const target = taggedOf(node);
          if (target) {
            use(node, `uses ${target.name} (@${tag}, ${target.path})`);
          }
        } else if (
          ts.isIdentifier(node) &&
          !isBindingName(node) &&
          !inTypePosition(node)
        ) {
          const target = taggedOf(node);
          const whole = target ? undefined : namespaceOf(node);
          if (target) {
            use(node, `uses ${target.name} (@${tag}, ${target.path})`);
          } else if (whole && !reachesByName(node)) {
            use(
              node,
              `uses the namespace of ${pathOf.get(whole)} (@${tag} ${taggedIn.get(whole).join(', ')}) as a whole`,
              ` — ${check} cannot follow which export it reaches; reach it by name`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  const names = [...new Set([...tagged.values()].map(({ name }) => name))];
  return { names, lines, uses };
}

/**
 * P7 — no deployed project can construct an emulator-only adapter. An
 * export of the functions tagged `@emulatorOnly` in its JSDoc — the console
 * OTP sender, which writes every sign-in code to the log and reports it
 * delivered; the fixed-code OTP crypto and its code — is the emulator's
 * alone: wired in a deployed project, nobody receives a code, or everybody
 * knows it. Over the functions' source (`sources`: `{ path, text }` for
 * every file tsconfig.app.json builds under `root`), every use of such an
 * export ({@link taggedExportUses}: followed through renames, re-exports
 * and run-time loads; the tag anchoring only on an exported top-level
 * `const` or `function`) sits behind the composition root's `onEmulator()`
 * — the true branch of `onEmulator() ? … : …` or the then-block of
 * `if (onEmulator())` — or inside another tagged declaration, which is
 * judged where it is used in turn.
 */
export function checkEmulatorOnly({ root, sources }) {
  if (sources.length === 0) {
    return row('P7', Verdict.Fail, `no functions source under ${root}`);
  }
  const { names, lines, uses } = taggedExportUses({
    sources,
    tag: EMULATOR_ONLY_TAG,
    check: 'P7',
  });
  let gated = 0;
  for (const { at, node, head, tail } of uses) {
    if (behindEmulatorGate(node)) gated += 1;
    else lines.push(`${at} ${head} outside the emulator${tail}`);
  }
  if (lines.length > 0) {
    return row(
      'P7',
      Verdict.Fail,
      'an emulator-only adapter is not provably behind onEmulator()',
      [...lines, EMULATOR_ONLY_HINT],
    );
  }
  const used =
    gated === 0
      ? 'never used'
      : `${gated === 1 ? 'the one use' : `all ${gated} uses`} behind ${EMULATOR_GATE}()`;
  return row(
    'P7',
    Verdict.Pass,
    names.length === 0
      ? `no @${EMULATOR_ONLY_TAG} export in ${sources.length} files under ${root}`
      : `${names.join(', ')}: ${used}`,
  );
}

/**
 * P8 — no launch-blocker stand-in is wired. An export of the
 * functions tagged `@launchBlocker` in its JSDoc stands in for something a
 * launch needs — today `refusingOtpSender`, the deployed project's login-OTP
 * sender until a transactional provider lands, which refuses every sign-in
 * with `IDENTITY_OTP_SEND_UNAVAILABLE`. P8 fails while ANY use of such an
 * export remains in the functions' source, behind a gate or not, followed
 * exactly as P7 follows its own tag ({@link taggedExportUses}: renames,
 * re-exports, run-time loads, a load it cannot name, a tag that anchors
 * nothing), and passes once no tagged export is used. It reads no project.
 * A PASS proves no tagged stand-in is wired, not that a code arrives: that
 * proof is docs/production-deploy.md §1's checkbox and §4's post-deploy
 * check (request an OTP and receive it).
 */
export function checkLaunchBlockers({ root, sources }) {
  if (sources.length === 0) {
    return row('P8', Verdict.Fail, `no functions source under ${root}`);
  }
  const { names, lines, uses } = taggedExportUses({
    sources,
    tag: LAUNCH_BLOCKER_TAG,
    check: 'P8',
  });
  for (const { at, head, tail } of uses) lines.push(`${at} ${head}${tail}`);
  if (lines.length > 0) {
    return row(
      'P8',
      Verdict.Fail,
      'a launch blocker is still wired into the functions',
      [...lines, LAUNCH_BLOCKER_HINT],
    );
  }
  return row(
    'P8',
    Verdict.Pass,
    names.length === 0
      ? `no @${LAUNCH_BLOCKER_TAG} export in ${sources.length} files under ${root}`
      : `${names.join(', ')}: never used`,
  );
}

/**
 * Every check of `scope`, over what `read` answers: `domain()` (the seed
 * bundle), `location(domain)` (the default location as stored, or `null`),
 * `declared()` (firestore.indexes.json), `ttlFields()` and `indexes()` (the
 * project's listings), `bundle()` (`{ dist, scripts }`), `config()`
 * (firebase.json) and `functionsSource()` (`{ root, sources }`). A read that
 * throws fails its check; P6 runs first and, failing, keeps P1–P3 from
 * reading at all — P7 and P8 read the repository only (one read, shared),
 * so they run either way.
 */
export async function runPreflight({ scope, projectId, env, read }) {
  const environment = checkEnvironment({ env, projectId });
  const functionsSource = once(() => read.functionsSource());
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
    P7: async () => checkEmulatorOnly(await functionsSource()),
    P8: async () => checkLaunchBlockers(await functionsSource()),
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

/**
 * The banner the escape hatch prints instead of the table: what the
 * scope's checks would have proved, and the command that proves it — the
 * same scope, since a by-hand run defaults to `web` and would skip P7 and P8.
 */
export function skipBanner({ projectId, scope }) {
  const bar = '!'.repeat(78);
  const subjects = SCOPES[scope].map((check) => SUBJECTS[check]);
  return [
    bar,
    `!!! CREATIVO_SKIP_PREFLIGHT=1 — the production preflight did NOT run (scope ${scope}, ${SCOPES[scope].join(' ')}).`,
    `!!! Nothing proved ${subjects.slice(0, -1).join(', ')} or ${subjects.at(-1)} of ${projectId || '(no project)'}.`,
    `!!! Run \`pnpm run preflight --scope ${scope} --project ${projectId || '<id>'}\` after this deploy.`,
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

/**
 * Every file under `dir` whose path relative to `dir` (`/`-separated)
 * `keep` accepts, as `{ path, text }` (`path` relative to the working
 * directory).
 */
function filesUnder(dir, keep) {
  const files = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (keep(relative(dir, full).split(sep).join('/'))) {
        files.push({
          path: relative(process.cwd(), full),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(dir);
  return files;
}

/** Every `.js` / `.mjs` file under `dir`. */
function scriptsUnder(dir) {
  return filesUnder(dir, (inner) => /\.m?js$/.test(inner));
}

/** The files under `dir` (the functions' `src`) that tsconfig.app.json builds: every `.ts` but specs, tests and `test-support/`. */
export function functionsSourceUnder(dir) {
  return existsSync(dir)
    ? filesUnder(
        dir,
        (inner) => inner.endsWith('.ts') && !NOT_BUILT.test(inner),
      )
    : [];
}

/** Calls `load` once and hands every caller the same promise. */
function once(load) {
  let pending;
  return () => (pending ??= load());
}

/**
 * The live reads for `options`: the files on disk (the functions' source
 * among them), the default location through firebase-admin, and the two
 * listings through the Firestore Admin REST API — all under the one
 * application-default credential. firebase-admin loads only when a project
 * read runs.
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
    functionsSource: async () => ({
      root: FUNCTIONS_SOURCE,
      sources: functionsSourceUnder(resolve(FUNCTIONS_SOURCE)),
    }),
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
