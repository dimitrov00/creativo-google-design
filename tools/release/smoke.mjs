#!/usr/bin/env node
// The deploy's smoke check (ADR 2026-11-18, E6): the site a deploy just
// released answers as this release, read the way a browser reads it.
//
//   node tools/release/smoke.mjs --origin https://<project>.web.app --project <id> --release <stamp>
//
// Passes when:
//   - `/` answers 200 with HTML that loads exactly one `main-*.js`, under a
//     Content-Security-Policy whose connect-src names the project's callables
//     host and no other (what the CSP gate and the preflight's P5 proved of
//     the file, proved of the served header);
//   - the initial scripts — the main script and every chunk it imports
//     statically, transitively — carry the release stamp: the new build is
//     the one being served, not a cached older one;
//   - a deep link (`/book`) answers 200 with the same index (the SPA rewrite);
//   - `/ngsw.json` answers 200 (the service worker's manifest).
//
// Hosting releases atomically and index.html is served `no-cache`, so a
// miss is retried a few times, a few seconds apart, then fails. Exits 1 on a
// failed check, 2 on bad arguments. The pure parts are exported for the spec.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CSP_HEADER,
  functionsHost,
  parsePolicy,
} from '../verify/csp/check-csp.mjs';

/** The deep link the SPA rewrite must answer. */
export const DEEP_LINK = '/book';
/** How many reads before a miss is a failure, and how far apart. */
const ATTEMPTS = 5;
const PAUSE_MS = 6_000;
/** One request's bound. */
const REQUEST_TIMEOUT_MS = 20_000;
/** The most initial scripts followed — a bound, not an expectation. */
const MAX_SCRIPTS = 200;

/** The `main-*.js` an index.html loads; `null` unless it names exactly one. */
export function mainScriptOf(html) {
  const found = [
    ...html.matchAll(/<script\b[^>]*\bsrc="([^"]*\bmain-[\w-]+\.js)"/g),
  ];
  return found.length === 1 ? found[0][1] : null;
}

/** The chunks a script imports statically (`import … from"./chunk-X.js"`, `import"./chunk-X.js"`) — never a dynamic `import()`. */
export function staticImportsOf(script) {
  return [
    ...new Set(
      [
        ...script.matchAll(
          /(?:\bfrom|\bimport)\s*["'](\.\/chunk-[\w-]+\.js)["']/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
}

/** The complaints about a served policy: its connect-src must name `project`'s callables host, alone. */
export function policyProblems(policy, project) {
  if (typeof policy !== 'string' || policy === '') {
    return [`no ${CSP_HEADER} header`];
  }
  const callables = (parsePolicy(policy).get('connect-src') ?? []).filter(
    (source) => source.includes('cloudfunctions.net'),
  );
  const host = functionsHost(project);
  return callables.length === 1 && callables[0] === host
    ? []
    : [
        `connect-src names ${callables.join(' ') || 'no callables host'}, not ${host} alone`,
      ];
}

/** One read: `{ status, text, csp }`. */
async function get(fetchText, url) {
  return fetchText(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/**
 * Every check, once, through `fetchText(url) → { status, text, csp }`:
 * the complaints, empty when the site is this release.
 */
export async function smokeOnce({ origin, project, release, fetchText }) {
  const problems = [];
  const index = await get(fetchText, `${origin}/`);
  if (index.status !== 200) return [`/ answered ${index.status}`];
  problems.push(...policyProblems(index.csp, project));
  const main = mainScriptOf(index.text);
  if (main === null) return [...problems, '/ loads no single main-*.js'];

  // The initial graph: the main script and its static imports, transitively.
  const seen = new Set();
  const queue = [new URL(main, `${origin}/`).href];
  let stamped = false;
  while (queue.length > 0 && seen.size < MAX_SCRIPTS) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const script = await get(fetchText, url);
    if (script.status !== 200) {
      problems.push(`${url} answered ${script.status}`);
      continue;
    }
    if (script.text.includes(release)) stamped = true;
    for (const chunk of staticImportsOf(script.text)) {
      queue.push(new URL(chunk, url).href);
    }
  }
  if (!stamped) {
    problems.push(
      `no initial script carries the release ${release} — an older build is still served`,
    );
  }

  const deep = await get(fetchText, `${origin}${DEEP_LINK}`);
  if (deep.status !== 200 || mainScriptOf(deep.text) !== main) {
    problems.push(
      `${DEEP_LINK} answered ${deep.status}${deep.status === 200 ? ' with another page' : ''} — the SPA rewrite`,
    );
  }
  const manifest = await get(fetchText, `${origin}/ngsw.json`);
  if (manifest.status !== 200) {
    problems.push(`/ngsw.json answered ${manifest.status}`);
  }
  return problems;
}

/** The checks, retried while they miss: the last attempt's complaints. */
export async function smoke({
  origin,
  project,
  release,
  fetchText,
  pause = (ms) => new Promise((done) => setTimeout(done, ms)),
  attempts = ATTEMPTS,
}) {
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      problems = await smokeOnce({ origin, project, release, fetchText });
    } catch (error) {
      problems = [`cannot read ${origin}: ${error.message}`];
    }
    if (problems.length === 0) return [];
    if (attempt < attempts) await pause(PAUSE_MS);
  }
  return problems;
}

/** The live reader: a GET's status, body and policy header. */
async function fetchLive(url, init) {
  const response = await fetch(url, { ...init, redirect: 'follow' });
  return {
    status: response.status,
    text: await response.text(),
    csp: response.headers.get(CSP_HEADER),
  };
}

/** The command. Answers the exit code. */
export async function main({ args, fetchText, print, warn, pause }) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        origin: { type: 'string' },
        project: { type: 'string' },
        release: { type: 'string' },
      },
      strict: true,
    }));
    for (const name of ['origin', 'project', 'release']) {
      if (!values[name]) throw new Error(`--${name} is required`);
    }
    if (!/^https:\/\/[^/]+$/.test(values.origin)) {
      throw new Error('--origin is an https origin, no path');
    }
  } catch (error) {
    warn(
      `smoke: ${error.message}\nusage: node tools/release/smoke.mjs --origin https://<site> --project <id> --release <stamp>`,
    );
    return 2;
  }
  const problems = await smoke({ ...values, fetchText, pause });
  if (problems.length > 0) {
    warn(
      `smoke: FAIL — ${values.origin} is not ${values.release}:\n  ${problems.join('\n  ')}`,
    );
    return 1;
  }
  print(
    `smoke: PASS — ${values.origin} serves ${values.release}: the index, its CSP, the initial scripts, ${DEEP_LINK} and the service worker manifest`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main({
    args: process.argv.slice(2),
    fetchText: fetchLive,
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
