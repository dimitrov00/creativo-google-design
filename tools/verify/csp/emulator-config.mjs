#!/usr/bin/env node
// The CSP smoke's Firebase config (owner ruling OR-31): firebase.json with
// the emulators' 127.0.0.1 origins added to the policy, and nothing else
// changed that a header could see.
//
//   node tools/verify/csp/emulator-config.mjs [--public=dist/apps/web-csp-smoke/browser] [--out=dist/firebase.csp-smoke.json]
//
// The smoke serves the `csp-smoke` build through the Hosting emulator, and
// that build's SDKs talk to the Auth, Firestore, Functions and Storage
// emulators on the page's own host — origins production's policy rightly
// refuses. So this writes an UNTRACKED superset (under dist/, which git
// ignores) and asserts the difference before it writes:
//
//   - the header rules keep their sources, their order, their keys and
//     every value — but the policy's;
//   - the policy keeps every directive and every source, in order; the only
//     sources it gains are the emulator origins, in connect-src (all four)
//     and img-src (Storage's, for a photo or an avatar), and it loses none.
//
// The rest is plumbing the emulators need, not a header: the Firebase CLI
// takes the directory of a `--config` file as the project's, so the site's
// `public` and the functions' `source` are re-pointed relative to the
// written file (the CLI joins both under that directory) and the rules
// files are named absolutely (the CLI reads an absolute path as given); the
// site is named by `site` (the demo project has no `.firebaserc` target),
// and `public` names the smoke's build. Run by `pnpm run verify:csp`, which
// passes the written file to `firebase emulators:exec --config`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CSP_HEADER,
  headerOf,
  parsePolicy,
  serializePolicy,
  webHosting,
} from './check-csp.mjs';

/** The demo project every emulator script runs under (`package.json`). */
const EMULATOR_PROJECT = 'demo-creativo-test';

/** The host the smoke serves on, and the SDKs follow (`environment.ts`: the page's own). */
const EMULATOR_HOST = '127.0.0.1';

/** The emulators the browser talks to, and the directives each origin joins. */
const BROWSER_EMULATORS = [
  { emulator: 'auth', directives: ['connect-src'] },
  { emulator: 'firestore', directives: ['connect-src'] },
  { emulator: 'functions', directives: ['connect-src'] },
  { emulator: 'storage', directives: ['connect-src', 'img-src'] },
];

/** `directive → the origins it gains`, from firebase.json's emulator ports. */
export function emulatorSources(config) {
  const added = new Map();
  for (const { emulator, directives } of BROWSER_EMULATORS) {
    const port = config.emulators?.[emulator]?.port;
    if (!Number.isInteger(port)) {
      throw new Error(
        `firebase.json names no port for the ${emulator} emulator`,
      );
    }
    for (const directive of directives) {
      added.set(directive, [
        ...(added.get(directive) ?? []),
        `http://${EMULATOR_HOST}:${port}`,
      ]);
    }
  }
  return added;
}

/** The production policy with `added`'s sources appended to their directives. */
export function supersetPolicy(policy, added) {
  const superset = new Map();
  for (const [name, sources] of parsePolicy(policy)) {
    superset.set(name, [...sources, ...(added.get(name) ?? [])]);
  }
  for (const name of added.keys()) {
    if (!superset.has(name)) {
      throw new Error(
        `the policy has no ${name} to add the emulator origins to`,
      );
    }
  }
  return serializePolicy(superset);
}

/**
 * The difference between two header rule lists, as a list of complaints —
 * empty when `generated` differs from `production` ONLY by `added` in the
 * `**` rule's policy.
 */
export function headerDifference(production, generated, added) {
  const complaints = [];
  if (production.length !== generated.length) {
    return [`${production.length} header rules became ${generated.length}`];
  }
  production.forEach((rule, index) => {
    const twin = generated[index];
    if (rule.source !== twin.source) {
      complaints.push(
        `rule ${index}: source ${rule.source} became ${twin.source}`,
      );
    }
    const keys = (rule.headers ?? []).map((header) => header.key);
    const twinKeys = (twin.headers ?? []).map((header) => header.key);
    if (keys.join('\n') !== twinKeys.join('\n')) {
      complaints.push(`rule ${index}: headers ${keys} became ${twinKeys}`);
      return;
    }
    for (const key of keys) {
      const before = headerOf(rule, key);
      const after = headerOf(twin, key);
      if (rule.source === '**' && key === CSP_HEADER) continue;
      if (before !== after) complaints.push(`rule ${index}: ${key} changed`);
    }
  });
  const all = production.findIndex((rule) => rule.source === '**');
  if (all === -1) return [...complaints, 'no `**` rule'];
  const before = parsePolicy(headerOf(production[all], CSP_HEADER) ?? '');
  const after = parsePolicy(headerOf(generated[all], CSP_HEADER) ?? '');
  if ([...before.keys()].join(' ') !== [...after.keys()].join(' ')) {
    complaints.push('the policy’s directives changed');
    return complaints;
  }
  for (const [name, sources] of before) {
    const now = after.get(name) ?? [];
    const lost = sources.filter((source) => !now.includes(source));
    const gained = now.filter((source) => !sources.includes(source));
    const allowed = added.get(name) ?? [];
    if (lost.length > 0) complaints.push(`${name} lost ${lost.join(' ')}`);
    if (gained.join(' ') !== allowed.join(' ')) {
      complaints.push(
        `${name} gained ${gained.join(' ') || 'nothing'}, may gain only ${allowed.join(' ') || 'nothing'}`,
      );
    }
  }
  return complaints;
}

/** A path the CLI joins under the config's directory — never outside it. */
function joinedUnder(outDir, path) {
  const relativePath = relative(outDir, resolve(path));
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(
      `${path} is outside ${outDir}, where the CLI would refuse it`,
    );
  }
  return relativePath;
}

/** The smoke's config: production's, the policy widened, the plumbing re-pointed. */
export function smokeConfig(config, { publicDir, outFile }) {
  const outDir = dirname(resolve(outFile));
  const hosting = webHosting(config);
  if (hosting === null)
    throw new Error('no hosting entry with `target: "web"`');
  const added = emulatorSources(config);
  const headers = (hosting.headers ?? []).map((rule) =>
    rule.source !== '**'
      ? rule
      : {
          ...rule,
          headers: rule.headers.map((header) =>
            header.key === CSP_HEADER
              ? { ...header, value: supersetPolicy(header.value, added) }
              : header,
          ),
        },
  );
  const complaints = headerDifference(hosting.headers ?? [], headers, added);
  if (complaints.length > 0) {
    throw new Error(
      `the smoke's headers differ beyond the emulator origins:\n  ${complaints.join('\n  ')}`,
    );
  }
  // The demo project maps no target to a site: the site is named instead.
  const site = { ...hosting };
  delete site.target;
  return {
    ...config,
    firestore: {
      ...config.firestore,
      rules: resolve(config.firestore.rules),
      indexes: resolve(config.firestore.indexes),
    },
    storage: { ...config.storage, rules: resolve(config.storage.rules) },
    functions: {
      ...config.functions,
      source: joinedUnder(outDir, config.functions.source),
    },
    hosting: [
      {
        ...site,
        site: EMULATOR_PROJECT,
        public: joinedUnder(outDir, publicDir),
        headers,
      },
    ],
  };
}

function main(args) {
  const option = (name, fallback) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ??
    fallback;
  const publicDir = option('public', 'dist/apps/web-csp-smoke/browser');
  const outFile = resolve(option('out', 'dist/firebase.csp-smoke.json'));
  const config = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'));
  let smoke;
  try {
    smoke = smokeConfig(config, { publicDir, outFile });
  } catch (error) {
    console.error(`FAIL — ${error.message}`);
    return 1;
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(smoke, null, 2)}\n`);
  const added = emulatorSources(config);
  console.log(
    `CSP smoke config written to ${relative(process.cwd(), outFile)}:`,
  );
  for (const [name, sources] of added) {
    console.log(`  ${name} + ${sources.join(' ')}`);
  }
  console.log('  every other header, directive and source as in firebase.json');
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
