// tools/ops/shop-location.mjs — the shop document a new project needs before
// its first deploy (docs/production-deploy.md §2): held to the preflight's
// own P1 before anything else, dry by default, and on --apply a create, a
// no-op or a refusal unless --replace — never a merge.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { LEGACY_PROJECT_IDS } from '../../release/legacy-projects.mjs';
import { loadSeedDomain } from '../../seed/load-domain.mjs';
import {
  WriteAction,
  bodyOf,
  changedKeys,
  optionsOf,
  planWrite,
  shopLocation,
} from '../../ops/shop-location.mjs';

let domain;
before(async () => {
  domain = await loadSeedDomain();
});

/** The seed's own default shop, as plain JSON. */
const example = () =>
  JSON.parse(
    JSON.stringify(
      domain.catalog.LOCATIONS.find(
        (shop) => shop.id === domain.TenantConfig.DEFAULT.defaultLocationId,
      ).body,
    ),
  );

/** A store in memory; `calls` records every write. */
function memoryStore(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const calls = [];
  return {
    calls,
    docs,
    get: async (id) => (docs.has(id) ? structuredClone(docs.get(id)) : null),
    create: async (id, body) => {
      calls.push(['create', id]);
      if (docs.has(id)) throw new Error('ALREADY_EXISTS');
      docs.set(id, structuredClone(body));
    },
    set: async (id, body) => {
      calls.push(['set', id]);
      docs.set(id, structuredClone(body));
    },
    close: async () => calls.push(['close']),
  };
}

/** One run of the script: its exit code, what it printed and warned, and whether it opened a store. */
async function run(args, { store = memoryStore(), env = {}, files = {} } = {}) {
  const out = [];
  const err = [];
  let opened = null;
  let loaded = false;
  const code = await shopLocation({
    args,
    env,
    loadDomain: async () => {
      loaded = true;
      return domain;
    },
    readFile: (path) => {
      if (!(path in files)) throw new Error('ENOENT');
      return files[path];
    },
    firestoreFor: async (projectId, collection) => {
      opened = { projectId, collection };
      return store;
    },
    print: (line) => out.push(line),
    warn: (line) => err.push(line),
  });
  return {
    code,
    out: out.join('\n'),
    err: err.join('\n'),
    opened,
    loaded,
    store,
  };
}

const APPLY = ['--example', '--project', 'creativo-v2-staging', '--apply'];

describe('tools/ops/shop-location.mjs — the shop document (docs/production-deploy.md §2)', () => {
  it('takes exactly one source, and writes only with a project and --apply', () => {
    assert.equal(optionsOf(['--example']).ok, true);
    assert.equal(optionsOf(['--from', 'shop.json']).ok, true);
    for (const bad of [
      [],
      ['--example', '--from', 'shop.json'],
      ['--example', '--apply'],
      ['--example', '--replace'],
      ['--example', '--template', '--project', 'p', '--apply'],
      ['--example', '--unknown'],
    ]) {
      assert.equal(optionsOf(bad).ok, false, bad.join(' '));
    }
  });

  it('holds the seed’s default shop to the preflight’s P1, and prints it without reading anything', async () => {
    const { code, out, opened } = await run(['--example']);
    assert.equal(code, 0);
    assert.match(
      out,
      /^# PASS — locations\/loc-center: timeZone Europe\/Sofia$/m,
    );
    assert.match(out, /^# dry run: nothing was read or written\./m);
    assert.deepEqual(
      JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)),
      example(),
    );
    assert.equal(opened, null, 'a dry run opens no store');
  });

  it('prints a template to edit, and reads a body back from a file', async () => {
    const template = await run(['--example', '--template']);
    assert.equal(template.code, 0);
    assert.deepEqual(JSON.parse(template.out), example());
    const fromFile = await run(['--from', 'shop.json'], {
      files: { 'shop.json': template.out },
    });
    assert.equal(fromFile.code, 0, fromFile.err);
  });

  it('refuses what the deploy or the app would stumble on: the zone, the fields, the week, the name, a body holding its id', async () => {
    const week = example().openingHours;
    const cases = {
      unknownZone: { ...example(), timeZone: 'Mars/Olympus' },
      lowerCase: { ...example(), timeZone: 'europe/sofia' },
      missingField: Object.fromEntries(
        Object.entries(example()).filter(([key]) => key !== 'openingHours'),
      ),
      extraField: { ...example(), tenantId: 't' },
      sixDays: { ...example(), openingHours: week.slice(0, 6) },
      closesBeforeOpening: {
        ...example(),
        openingHours: [
          { openingState: 'OPEN', openMinutes: 600, closeMinutes: 540 },
          ...week.slice(1),
        ],
      },
      dayWithAStrayField: {
        ...example(),
        openingHours: [{ ...week[0], note: 'x' }, ...week.slice(1)],
      },
      noBulgarianName: { ...example(), name: { bg: ' ', en: 'Creativo' } },
      withId: { id: 'loc-center', ...example() },
    };
    for (const [name, body] of Object.entries(cases)) {
      const { code, err } = await run(['--from', 'shop.json'], {
        files: { 'shop.json': JSON.stringify(body) },
      });
      assert.equal(code, 1, name);
      assert.notEqual(err, '', name);
    }
    assert.equal(
      bodyOf({
        domain,
        id: 'loc-nowhere',
        options: { example: true },
        readFile: () => '',
      }).ok,
      false,
      'no example for a shop the seed does not have',
    );
  });

  it('refuses the legacy projects with exit 2 before the domain even loads', async () => {
    for (const legacy of LEGACY_PROJECT_IDS) {
      const { code, loaded, opened } = await run([
        '--example',
        '--project',
        legacy,
        '--apply',
      ]);
      assert.equal(code, 2, legacy);
      assert.equal(loaded, false, legacy);
      assert.equal(opened, null, legacy);
    }
  });

  it('runs the preflight’s P6 before it opens a store: never against an emulator', async () => {
    const { code, opened } = await run(APPLY, {
      env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    });
    assert.equal(code, 1);
    assert.equal(opened, null);
  });

  it('creates an absent shop, then reads it back through P1', async () => {
    const { code, out, opened, store } = await run(APPLY);
    assert.equal(code, 0);
    assert.deepEqual(opened, {
      projectId: 'creativo-v2-staging',
      collection: 'locations',
    });
    assert.deepEqual(store.calls, [['create', 'loc-center'], ['close']]);
    assert.deepEqual(store.docs.get('loc-center'), example());
    assert.match(out, /read back, the preflight's check \(P1\):\n# PASS/);
  });

  it('writes nothing over the same body, refuses a different one, and replaces it only with --replace', async () => {
    const same = await run(APPLY, {
      store: memoryStore({ 'loc-center': example() }),
    });
    assert.equal(same.code, 0);
    assert.deepEqual(same.store.calls, [['close']]);

    const changed = { ...example(), sortOrder: 7, phoneDisplay: 'x' };
    const refused = await run(APPLY, {
      store: memoryStore({ 'loc-center': changed }),
    });
    assert.equal(refused.code, 1);
    assert.match(refused.err, /differs in: phoneDisplay, sortOrder/);
    assert.deepEqual(refused.store.calls, [['close']]);

    const replaced = await run([...APPLY, '--replace'], {
      store: memoryStore({ 'loc-center': changed }),
    });
    assert.equal(replaced.code, 0);
    assert.deepEqual(replaced.store.calls, [['set', 'loc-center'], ['close']]);
    assert.deepEqual(replaced.store.docs.get('loc-center'), example());
  });

  it('plans by root field, keys either side', () => {
    assert.deepEqual(changedKeys({ a: 1, b: [1] }, { b: [1], c: 2 }), [
      'a',
      'c',
    ]);
    assert.equal(
      planWrite({ existing: null, body: {}, replace: false }).action,
      WriteAction.Create,
    );
    assert.equal(
      planWrite({ existing: { a: 1 }, body: { a: 1 }, replace: false }).action,
      WriteAction.Keep,
    );
    assert.equal(
      planWrite({ existing: { a: 1 }, body: { a: 2 }, replace: false }).action,
      WriteAction.Refuse,
    );
    assert.equal(
      planWrite({ existing: { a: 1 }, body: { a: 2 }, replace: true }).action,
      WriteAction.Replace,
    );
  });
});
