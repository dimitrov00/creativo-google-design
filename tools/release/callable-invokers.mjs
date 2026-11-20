#!/usr/bin/env node
// The deploy's invoker guard: after the functions deploy, every callable's
// Cloud Run service lets anyone invoke it, and no other function's does.
//
//   node tools/release/callable-invokers.mjs --project <id> [--dry-run]
//
// firebase-tools 15 makes a callable public only when it CREATES it
// (lib/deploy/functions/release/fabricator.js, createV2Function). An update,
// and a function skipped as unchanged, keeps whatever invoker it has. So a
// callable whose first create failed stays private for good: staging's first
// deploy (2026-11-19) failed every build, and its 37 callables then answered
// the browser's CORS preflight and every call with Cloud Run's own 403,
// before any code ran. This step closes that gap:
//   - a function labelled `deployment-callable: 'true'` (firebase-tools'
//     label) whose service lacks `allUsers` on `roles/run.invoker` gets it —
//     what its create would have granted. Who may do what is still decided
//     in the code (Firebase Auth, App Check, the staff permissions);
//   - any other function whose service admits `allUsers` or
//     `allAuthenticatedUsers` fails the step. Event triggers and schedules
//     are called by the runtime account only (ADR
//     docs/architecture/decisions/2026-11-19-functions-runtime-identity.md,
//     I1); a public one is a defect to look at, never to paper over.
//
// Reads and writes go through the Cloud Functions v2 and Cloud Run v2 APIs
// under the application-default credential — the deploy account in CI, whose
// roles/cloudfunctions.admin lists the functions and roles/run.admin reads
// and sets the services' policies. `--dry-run` reads and reports only.
// Exits 1 on a failed check, 2 on bad arguments. The pure parts are exported
// for the spec.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isLegacyProject, legacyRefusal } from './legacy-projects.mjs';

/** The role Cloud Run checks before a request reaches the code. */
export const INVOKER_ROLE = 'roles/run.invoker';
/** The member a callable needs: the browser's preflight carries no credential. */
export const PUBLIC_MEMBER = 'allUsers';
/** Every member that opens a service beyond the project's own accounts. */
export const OPEN_MEMBERS = Object.freeze([
  'allUsers',
  'allAuthenticatedUsers',
]);
/** firebase-tools' label on a callable (`deployment-callable: 'true'`). */
export const CALLABLE_LABEL = 'deployment-callable';

const FUNCTIONS_API = 'https://cloudfunctions.googleapis.com/v2';
const RUN_API = 'https://run.googleapis.com/v2';
/** One request's bound, and how a refused write (the per-minute quota) is retried. */
const REQUEST_TIMEOUT_MS = 30_000;
const ATTEMPTS = 5;
const PAUSE_MS = 15_000;

/** A function's short name: `projects/p/locations/r/functions/addBarber` → `addBarber`. */
export function shortName(name) {
  return String(name).split('/').at(-1);
}

/** Whether firebase-tools deployed the function as a callable. */
export function isCallable(fn) {
  return fn?.labels?.[CALLABLE_LABEL] === 'true';
}

/** The function's Cloud Run service (`projects/p/locations/r/services/s`), or `null`. */
export function serviceOf(fn) {
  const service = fn?.serviceConfig?.service;
  return typeof service === 'string' && service.length > 0 ? service : null;
}

/** The open members (`allUsers`, `allAuthenticatedUsers`) a policy lets invoke, unconditionally. */
export function openInvokersOf(policy) {
  const members = new Set();
  for (const binding of policy?.bindings ?? []) {
    if (binding.role !== INVOKER_ROLE || binding.condition) continue;
    for (const member of binding.members ?? []) {
      if (OPEN_MEMBERS.includes(member)) members.add(member);
    }
  }
  return [...members].sort();
}

/**
 * The same policy with `allUsers` on the unconditional invoker binding —
 * added to it, or a new binding when there is none. Every other binding,
 * the etag and the version are kept; the input is not changed.
 */
export function withPublicInvoker(policy) {
  const bindings = (policy?.bindings ?? []).map((binding) => ({
    ...binding,
    members: [...(binding.members ?? [])],
  }));
  const invoker = bindings.find(
    (binding) => binding.role === INVOKER_ROLE && !binding.condition,
  );
  if (!invoker) {
    bindings.push({ role: INVOKER_ROLE, members: [PUBLIC_MEMBER] });
  } else if (!invoker.members.includes(PUBLIC_MEMBER)) {
    invoker.members.push(PUBLIC_MEMBER);
  }
  return { ...policy, bindings };
}

/**
 * What the step does, from each function and its service's policy
 * (`{ fn, policy }`, `policy` `null` when the function has no service):
 * `grant` the callables not yet public, `exposed` the other functions open
 * to anyone, `unserved` the callables with no service to make public.
 */
export function planInvokers(entries) {
  const grant = [];
  const exposed = [];
  const unserved = [];
  let publicCallables = 0;
  let privateOthers = 0;
  for (const { fn, policy } of entries) {
    const name = shortName(fn.name);
    const service = serviceOf(fn);
    const open = openInvokersOf(policy);
    if (isCallable(fn)) {
      if (!service) unserved.push(name);
      else if (open.includes(PUBLIC_MEMBER)) publicCallables += 1;
      else grant.push({ name, service, policy });
    } else if (open.length > 0) {
      exposed.push({ name, members: open });
    } else {
      privateOthers += 1;
    }
  }
  return { grant, exposed, unserved, publicCallables, privateOthers };
}

/**
 * The step over `api` (`listFunctions()`, `getPolicy(service)`,
 * `setPolicy(service, policy)`): grants what `planInvokers` finds missing,
 * unless `dryRun`, and answers `{ problems, lines }` — the failures and the
 * report.
 */
export async function ensureInvokers({ api, dryRun = false }) {
  const functions = await api.listFunctions();
  const entries = [];
  for (const fn of functions) {
    const service = serviceOf(fn);
    entries.push({ fn, policy: service ? await api.getPolicy(service) : null });
  }
  const plan = planInvokers(entries);
  const problems = [];
  const lines = [];
  let madePublic = 0;

  for (const { name, service, policy } of plan.grant) {
    if (dryRun) {
      lines.push(
        `would make ${name} public (${INVOKER_ROLE} ${PUBLIC_MEMBER})`,
      );
      continue;
    }
    try {
      await api.setPolicy(service, withPublicInvoker(policy));
      madePublic += 1;
      lines.push(`made ${name} public (${INVOKER_ROLE} ${PUBLIC_MEMBER})`);
    } catch (error) {
      problems.push(`${name}: could not be made public — ${error.message}`);
    }
  }
  for (const name of plan.unserved) {
    problems.push(
      `${name}: a callable with no Cloud Run service — its deploy did not finish`,
    );
  }
  for (const { name, members } of plan.exposed) {
    problems.push(
      `${name}: not a callable, yet ${members.join(' and ')} may invoke it — only its runtime account should`,
    );
  }
  if (dryRun && plan.grant.length > 0) {
    problems.push(
      `${plan.grant.length} callable(s) are private (dry run: nothing changed)`,
    );
  }

  lines.push(
    `${plan.publicCallables + madePublic} of ${plan.publicCallables + plan.grant.length + plan.unserved.length} callables public; ${plan.privateOthers} other function(s) private`,
  );
  return { problems, lines };
}

/** The live API under the application-default credential, the project as the quota project. */
function liveApi(projectId) {
  let credential;
  async function token() {
    if (!credential) {
      const { applicationDefault } = await import('firebase-admin/app');
      credential = applicationDefault();
    }
    return (await credential.getAccessToken()).access_token;
  }

  /** One call; a 429 or 503 (the per-minute quota, a busy API) is retried a few times. */
  async function call(method, url, label, body) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          'x-goog-user-project': projectId,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return json;
      if ([429, 503].includes(response.status) && attempt < ATTEMPTS) {
        await new Promise((done) => setTimeout(done, PAUSE_MS));
        continue;
      }
      throw new Error(
        `${label}: HTTP ${response.status}${json.error?.message ? ` — ${json.error.message}` : ''}`,
      );
    }
  }

  return {
    async listFunctions() {
      const functions = [];
      let pageToken = '';
      do {
        const url = new URL(
          `${FUNCTIONS_API}/projects/${projectId}/locations/-/functions`,
        );
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const body = await call('GET', url, 'list the functions');
        functions.push(...(body.functions ?? []));
        pageToken = body.nextPageToken ?? '';
      } while (pageToken);
      return functions;
    },
    getPolicy: (service) =>
      call(
        'GET',
        `${RUN_API}/${service}:getIamPolicy`,
        `read ${service}'s policy`,
      ),
    setPolicy: (service, policy) =>
      call(
        'POST',
        `${RUN_API}/${service}:setIamPolicy`,
        `set ${service}'s policy`,
        {
          policy,
        },
      ),
  };
}

/** The command. Answers the exit code. */
export async function main({ args, api, print, warn }) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        project: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
    }));
    if (!values.project) throw new Error('--project is required');
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project)) {
      throw new Error(`--project ${values.project} is not a project id`);
    }
    if (isLegacyProject(values.project)) {
      throw new Error(legacyRefusal(values.project));
    }
  } catch (error) {
    warn(
      `invokers: ${error.message}\nusage: node tools/release/callable-invokers.mjs --project <id> [--dry-run]`,
    );
    return 2;
  }

  let result;
  try {
    result = await ensureInvokers({
      api: api ?? liveApi(values.project),
      dryRun: values['dry-run'],
    });
  } catch (error) {
    warn(`invokers: FAIL — ${values.project}: ${error.message}`);
    return 1;
  }
  for (const line of result.lines) print(`invokers: ${line}`);
  if (result.problems.length > 0) {
    warn(
      `invokers: FAIL — ${values.project}:\n  ${result.problems.join('\n  ')}`,
    );
    return 1;
  }
  print(
    `invokers: PASS — ${values.project}: every callable answers the public, and no other function does`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main({
    args: process.argv.slice(2),
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
