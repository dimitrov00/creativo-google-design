#!/usr/bin/env node
// A shop's document, `locations/{id}` — by default the tenant's default shop
// `locations/loc-center` (`TenantConfig.DEFAULT`), which every deploy's
// preflight refuses to go without (P1) and whose `timeZone` is the clock
// every booking of the shop is read on (Law 7.2). Nothing in the app writes
// `locations`: the rules refuse every client write and there is no admin
// screen for shops yet (docs/production-deploy.md §2), so a new project gets
// its shop from this script, run once by the owner.
//
//   node tools/ops/shop-location.mjs --example                                  # dry run
//   node tools/ops/shop-location.mjs --from shop.json --project <id>            # dry run
//   node tools/ops/shop-location.mjs --from shop.json --project <id> --apply    # writes
//   node tools/ops/shop-location.mjs --example --template > shop.json           # a body to edit
//
// The body comes from exactly one source:
//   --example         the dev seed's own shop (tools/seed/fixtures/catalog.fixtures.ts),
//                     example data: fine for staging, never production's;
//   --from <file>     a JSON body — the flat ShopLocation minus its id, the
//                     same layout the seed's body has (--template prints one).
// It is held, before anything else, to the whole shape of a shop (every
// field of the seed's typed example and no other, a Bulgarian name and
// address, a week `DayHours.parseWeek` admits: `shapeProblems`, because
// `locations` has no read guard) and to the check every deploy's preflight
// runs on the default shop (P1, `checkLocation`: the read guard, then a
// canonical IANA timeZone) — so the script never writes a shop the app or
// the deploy would stumble on.
//
// Dry run by default: it reads and writes nothing. --apply needs --project,
// refuses the legacy projects first (before the domain even loads), then
// runs the preflight's P6 (no emulator variable, a real project of this
// product's), reads `locations/{id}` through firebase-admin under the
// application-default credentials (`gcloud auth application-default login`
// first), and:
//   absent                → creates it;
//   present, the same     → writes nothing;
//   present, different    → refuses, naming the fields, unless --replace
//                           (which writes the whole body over it: a flat
//                           archetype, never a merge).
// It then reads the document back and runs P1 on what is stored. Written
// before the first functions deploy, the document leaves no audit row
// (`auditLocationsChanges` does not exist yet); written after, it is
// recorded as `SYSTEM` / `ADMIN_SDK`.
//
// --apply writes to a project: the owner runs it, never an agent session.
// Exits 0 when done (or nothing to do), 1 on a refused body or write, 2 on
// unreadable arguments or a legacy project.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isLegacyProject, legacyRefusal } from '../release/legacy-projects.mjs';
import { loadSeedDomain } from '../seed/load-domain.mjs';
import {
  Verdict,
  checkEnvironment,
  checkLocation,
} from '../verify/preflight/preflight.mjs';

export const USAGE =
  'usage: node tools/ops/shop-location.mjs (--example | --from <shop.json>) [--id <locationId>] [--project <id> [--apply [--replace]]] [--template]   (a dry run without --apply)';

/** What a write to an existing or absent document does. */
export const WriteAction = {
  Create: 'CREATE',
  Keep: 'KEEP',
  Replace: 'REPLACE',
  Refuse: 'REFUSE',
};

/** The arguments, read: `{ ok: true, value }` or `{ ok: false, problem }`. */
export function optionsOf(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        example: { type: 'boolean', default: false },
        from: { type: 'string' },
        id: { type: 'string' },
        project: { type: 'string' },
        apply: { type: 'boolean', default: false },
        replace: { type: 'boolean', default: false },
        template: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { ok: false, problem: error.message };
  }
  if (values.help) return { ok: true, value: { ...values } };
  const problems = [];
  if (values.example === (values.from !== undefined)) {
    problems.push('pass exactly one of --example or --from <shop.json>');
  }
  if (values.apply && !values.project) {
    problems.push('--apply needs --project <id>');
  }
  if (values.replace && !values.apply) {
    problems.push('--replace goes with --apply');
  }
  if (values.template && values.apply) {
    problems.push('--template prints a body, it never writes');
  }
  return problems.length === 0
    ? { ok: true, value: { ...values } }
    : { ok: false, problem: problems.join('; ') };
}

/**
 * The body to write, from its one source: `{ ok: true, value }` or
 * `{ ok: false, problem }`. A plain JSON value either way (what Firestore
 * stores and returns), never a document holding its own id.
 */
export function bodyOf({ domain, id, options, readFile }) {
  let body;
  if (options.example) {
    const entry = domain.catalog.LOCATIONS.find((shop) => shop.id === id);
    if (!entry) {
      const ids = domain.catalog.LOCATIONS.map((shop) => shop.id).join(', ');
      return {
        ok: false,
        problem: `the seed has no example for locations/${id} (its examples: ${ids})`,
      };
    }
    body = JSON.parse(JSON.stringify(entry.body));
  } else {
    try {
      body = JSON.parse(readFile(options.from));
    } catch (error) {
      return { ok: false, problem: `${options.from}: ${error.message}` };
    }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, problem: 'the body is one JSON object' };
  }
  if ('id' in body) {
    return {
      ok: false,
      problem: `the body never holds its id: the document's name is locations/${id}`,
    };
  }
  return { ok: true, value: body };
}

/** `{ errorCode: 'X', dayIndex: 2 }` → `X dayIndex=2`. */
function describeError(error) {
  return Object.entries(error)
    .map(([field, value]) =>
      field === 'errorCode' ? value : `${field}=${JSON.stringify(value)}`,
    )
    .join(' ');
}

/**
 * What P1 leaves unchecked: `locations` has no read guard
 * (`StoredDocumentSystem.guardOf` answers `null`), so the preflight reads a
 * shop as stored and judges its zone alone. The body must hold exactly the
 * fields of the seed's example shop (a literal that `satisfies
 * Body<ShopLocation>`, so the compiler holds its keys to the entity's), a
 * name and an address in Bulgarian, and a week `DayHours.parseWeek` (the
 * stored week's edge guard) admits as it stands. One line per problem;
 * none when the shape holds.
 */
export function shapeProblems({ domain, body }) {
  const expected = Object.keys(domain.catalog.LOCATIONS[0].body).sort();
  const actual = Object.keys(body).sort();
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  const problems = [];
  if (missing.length > 0) problems.push(`missing: ${missing.join(', ')}`);
  if (extra.length > 0) {
    problems.push(`not a shop field: ${extra.join(', ')}`);
  }
  for (const field of ['name', 'address']) {
    const text = body[field];
    if (typeof text?.bg !== 'string' || text.bg.trim() === '') {
      problems.push(`${field}.bg: the shop's ${field} in Bulgarian`);
    }
  }
  const week = body.openingHours;
  if (week === undefined) return problems;
  if (
    !Array.isArray(week) ||
    !week.every((day) => day !== null && typeof day === 'object')
  ) {
    problems.push('openingHours: seven days, Monday first, each one object');
    return problems;
  }
  const parsed = domain.DayHours.parseWeek(week);
  if (!parsed.ok) {
    problems.push(
      ...parsed.error.map((error) => `openingHours: ${describeError(error)}`),
    );
  } else if (
    !isDeepStrictEqual(JSON.parse(JSON.stringify(parsed.value)), week)
  ) {
    problems.push(
      'openingHours: each day holds only its own fields — openingState, and openMinutes and closeMinutes when OPEN',
    );
  }
  return problems;
}

/** The root fields whose values differ between two bodies, sorted. */
export function changedKeys(before, after) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((key) => !isDeepStrictEqual(before[key], after[key]))
    .sort();
}

/** What `--apply` does to the stored body (`existing`, or `null` when absent). */
export function planWrite({ existing, body, replace }) {
  if (existing === null) return { action: WriteAction.Create, changed: [] };
  const changed = changedKeys(existing, body);
  if (changed.length === 0) return { action: WriteAction.Keep, changed };
  return {
    action: replace ? WriteAction.Replace : WriteAction.Refuse,
    changed,
  };
}

/** One P1 row as the lines it prints. */
function rowLines(row) {
  return [
    `# ${row.verdict} — ${row.detail}`,
    ...row.lines.map((l) => `#   ${l}`),
  ];
}

/**
 * The script, its effects injected: `loadDomain` (the bundled production
 * domain), `readFile`, `firestoreFor(projectId, collection)` (a store with
 * `get(id)`, `create(id, body)`, `set(id, body)` and `close()`), `print`
 * and `warn`. Resolves to the exit code.
 */
export async function shopLocation({
  args,
  env,
  loadDomain,
  readFile,
  firestoreFor,
  print,
  warn,
}) {
  const parsed = optionsOf(args);
  if (!parsed.ok) {
    warn(parsed.problem);
    warn(USAGE);
    return 2;
  }
  const options = parsed.value;
  if (options.help) {
    print(USAGE);
    return 0;
  }
  if (options.project && isLegacyProject(options.project)) {
    warn(legacyRefusal(options.project));
    return 2;
  }

  const domain = await loadDomain();
  const id = options.id ?? domain.TenantConfig.DEFAULT.defaultLocationId;
  const path = `${domain.Collections.Locations}/${id}`;
  const body = bodyOf({ domain, id, options, readFile });
  if (!body.ok) {
    warn(body.problem);
    return 1;
  }
  const shape = shapeProblems({ domain, body: body.value });
  if (shape.length > 0) {
    warn(`# FAIL — ${path}: not a whole shop`);
    shape.forEach((line) => warn(`#   ${line}`));
    return 1;
  }
  const check = checkLocation({
    domain,
    id,
    stored: { id, ...body.value },
  });
  if (check.verdict !== Verdict.Pass) {
    rowLines(check).forEach((line) => warn(line));
    return 1;
  }
  if (options.template) {
    print(JSON.stringify(body.value, null, 2));
    return 0;
  }

  const project = options.project ?? 'your-project-id';
  print(
    `# ${path} for ${project} — the shop document (docs/production-deploy.md §2)`,
  );
  print(
    `# every field of a shop present (${Object.keys(body.value).length}), the week admitted by DayHours.parseWeek`,
  );
  print(`# the preflight's check (P1) on this body:`);
  rowLines(check).forEach((line) => print(line));
  if (options.example) {
    print(
      "# the body is the dev seed's example shop: fine for staging; production takes the real details with --from <shop.json> (--template prints this body to edit)",
    );
  }
  print(JSON.stringify(body.value, null, 2));
  if (!options.apply) {
    print(
      `# dry run: nothing was read or written. Re-run with --project <id> --apply to write ${path}.`,
    );
    return 0;
  }

  const environment = checkEnvironment({ env, projectId: options.project });
  if (environment.verdict !== Verdict.Pass) {
    rowLines(environment).forEach((line) => warn(line));
    return 1;
  }
  const store = await firestoreFor(
    options.project,
    domain.Collections.Locations,
  );
  try {
    const existing = await store.get(id);
    const plan = planWrite({
      existing,
      body: body.value,
      replace: options.replace,
    });
    switch (plan.action) {
      case WriteAction.Keep:
        print(`# ${path} already holds exactly this body: nothing to write`);
        break;
      case WriteAction.Refuse:
        warn(
          `${path} exists and differs in: ${plan.changed.join(', ')} — re-run with --replace to write this body over it`,
        );
        return 1;
      case WriteAction.Create:
        await store.create(id, body.value);
        print(`# created ${path}`);
        break;
      case WriteAction.Replace:
        await store.set(id, body.value);
        print(
          `# replaced ${path} (it differed in: ${plan.changed.join(', ')})`,
        );
        break;
      default:
        throw new Error(`unknown write action ${plan.action}`);
    }
    const stored = await store.get(id);
    const after = checkLocation({
      domain,
      id,
      stored: stored === null ? null : { id, ...stored },
    });
    print("# read back, the preflight's check (P1):");
    rowLines(after).forEach((line) => print(line));
    return after.verdict === Verdict.Pass ? 0 : 1;
  } finally {
    await store.close();
  }
}

/** `locations` in `projectId` through firebase-admin, under the application-default credentials. */
async function liveFirestore(projectId, collection) {
  const { applicationDefault, deleteApp, initializeApp } =
    await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    'creativo-shop-location',
  );
  const ref = (id) => getFirestore(app).collection(collection).doc(id);
  return {
    get: async (id) => {
      const snap = await ref(id).get();
      return snap.exists ? snap.data() : null;
    },
    create: (id, body) => ref(id).create(body),
    set: (id, body) => ref(id).set(body),
    close: () => deleteApp(app),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await shopLocation({
    args: process.argv.slice(2),
    env: process.env,
    loadDomain: loadSeedDomain,
    readFile: (path) => readFileSync(resolve(path), 'utf8'),
    firestoreFor: liveFirestore,
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
