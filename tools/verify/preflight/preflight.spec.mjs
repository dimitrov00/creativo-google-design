// node --test tools/verify/preflight/preflight.spec.mjs
//
// The production preflight's checks over fakes (owner ruling OR-35): what a
// project read, the indexes file, a build and firebase.json would answer —
// never a network, a credential or the seed bundle. The domain is a fake of
// the four names `tools/seed/load-domain.mjs` hands out (its own spec holds
// each equal to the ordinary import); the zone check answers as `Intl` does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  SCOPES,
  Verdict,
  checkBundle,
  checkComposites,
  checkConnectSrc,
  checkDefaultLocation,
  checkEnvironment,
  checkTtlPolicies,
  exitCodeOf,
  fieldKeyOf,
  optionsOf,
  preflight,
  renderTable,
  runPreflight,
  sameIndex,
} from './preflight.mjs';

const PROJECT = 'creativo-prod';
const HOST = `https://us-central1-${PROJECT}.cloudfunctions.net`;

/** The zone constructor's answers, as `ZonedTimeSystem.checkZone` gives them: canonical, or the refusal. */
function checkZone(raw) {
  try {
    const zone = new Intl.DateTimeFormat('en-US', {
      timeZone: raw,
    }).resolvedOptions().timeZone;
    return { ok: true, value: zone };
  } catch {
    return {
      ok: false,
      error: { errorCode: 'TIME_INVALID_TIME_ZONE', rawZone: raw },
    };
  }
}

/** The four names the preflight takes from the bundle; `guardFor` stands in for one collection's guard. */
function fakeDomain({ guardFor = null } = {}) {
  const guardOf = (collection) =>
    collection === 'locations' ? guardFor : null;
  return {
    TenantConfig: {
      DEFAULT: { defaultLocationId: 'loc-center', countryCallingCode: '359' },
    },
    Collections: { Locations: 'locations' },
    StoredDocumentSystem: {
      guardOf,
      admit(registry, collection, doc) {
        const guard = collection === null ? null : registry(collection);
        return guard === null ? { ok: true, value: doc } : guard(doc);
      },
    },
    ZonedTimeSystem: { checkZone },
  };
}

const LOCATION = {
  id: 'loc-center',
  name: 'Център',
  timeZone: 'Europe/Sofia',
  locationStatus: 'ACTIVE',
  sortOrder: 0,
};

const TTL_GROUPS = [
  'otps',
  'notifications',
  'waitlistRequests',
  'barberBusy',
  'capacity',
  'impersonationSessions',
  'barberLeadTimeSamples',
];

/** A firestore.indexes.json: two composites and the seven TTL overrides. */
const DECLARED = {
  indexes: [
    {
      collectionGroup: 'appointments',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'busyKeys', arrayConfig: 'CONTAINS' },
        { fieldPath: 'bookingStatus', order: 'ASCENDING' },
      ],
    },
    {
      collectionGroup: 'positions',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'positionStatus', order: 'ASCENDING' },
        { fieldPath: 'sortOrder', order: 'DESCENDING' },
      ],
    },
  ],
  fieldOverrides: [
    ...TTL_GROUPS.map((collectionGroup) => ({
      collectionGroup,
      fieldPath: 'purgeAt',
      ttl: true,
      indexes: [],
    })),
    {
      collectionGroup: 'barbers',
      fieldPath: 'locationIds',
      indexes: [],
    },
  ],
};

const PREFIX = `projects/${PROJECT}/databases/(default)/collectionGroups`;

/** The REST listing's TTL field for a group, in `state`. */
const ttlField = (group, state = 'ACTIVE') => ({
  name: `${PREFIX}/${group}/fields/purgeAt`,
  ttlConfig: { state },
});

/** The REST listing of a deployed composite: its name, `state`, and the `__name__` tiebreak Firestore appends. */
function listedIndex(spec, state = 'READY', id = 'CICAgOjXh4EK') {
  const last = spec.fields.findLast((field) => field.order)?.order;
  return {
    name: `${PREFIX}/${spec.collectionGroup}/indexes/${id}`,
    queryScope: spec.queryScope,
    fields: [
      ...spec.fields,
      { fieldPath: '__name__', order: last ?? 'ASCENDING' },
    ],
    state,
  };
}

/** A firebase.json whose web site's policy names `callables` in connect-src. */
function firebaseJson(callables) {
  return {
    hosting: [
      {
        target: 'web',
        headers: [
          {
            source: '**',
            headers: [
              {
                key: 'Content-Security-Policy',
                value: `default-src 'self'; connect-src 'self' https://firestore.googleapis.com ${callables.join(' ')}; object-src 'none'`,
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Readers that answer a healthy project, each overridable, and count their calls. */
function fakeReaders(overrides = {}) {
  const calls = [];
  const counted =
    (name, answer) =>
    async (...args) => {
      calls.push(name);
      return answer(...args);
    };
  const read = {
    domain: counted('domain', () => fakeDomain()),
    location: counted('location', () => LOCATION),
    declared: counted('declared', () => DECLARED),
    ttlFields: counted('ttlFields', () =>
      TTL_GROUPS.map((group) => ttlField(group)),
    ),
    indexes: counted('indexes', () =>
      DECLARED.indexes.map((spec) => listedIndex(spec)),
    ),
    bundle: counted('bundle', () => ({
      dist: 'dist/apps/web/browser',
      scripts: [
        {
          path: 'main-AB12.js',
          text: `const e={firebase:{apiKey:"AIza",projectId:"${PROJECT}"}};`,
        },
      ],
    })),
    config: counted('config', () => firebaseJson([HOST])),
    ...overrides,
  };
  return { read, calls };
}

describe('P1 · the default location', () => {
  it('passes on the default location stored with a canonical IANA zone', () => {
    const answer = checkDefaultLocation({
      domain: fakeDomain(),
      stored: LOCATION,
    });
    assert.equal(answer.verdict, Verdict.Pass);
    assert.match(
      answer.detail,
      /locations\/loc-center: timeZone Europe\/Sofia/,
    );
  });

  it('fails when the document is missing', () => {
    const answer = checkDefaultLocation({ domain: fakeDomain(), stored: null });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.match(answer.detail, /locations\/loc-center does not exist/);
  });

  it('fails on a zone the constructor refuses, naming the refusal', () => {
    const answer = checkDefaultLocation({
      domain: fakeDomain(),
      stored: { ...LOCATION, timeZone: 'Mars/Olympus' },
    });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.match(answer.detail, /"Mars\/Olympus" is refused/);
    assert.deepEqual(answer.lines, [
      'TIME_INVALID_TIME_ZONE rawZone="Mars/Olympus"',
    ]);
  });

  it('fails on a missing zone, and on a zone stored in another spelling than the canonical one', () => {
    assert.equal(
      checkDefaultLocation({
        domain: fakeDomain(),
        stored: { ...LOCATION, timeZone: undefined },
      }).verdict,
      Verdict.Fail,
    );
    const answer = checkDefaultLocation({
      domain: fakeDomain(),
      stored: { ...LOCATION, timeZone: 'europe/sofia' },
    });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.deepEqual(answer.lines, [
      'store "Europe/Sofia" — the readers use the stored zone as it is',
    ]);
  });

  it('reads through the guard the registry names, and fails on its refusal', () => {
    const refusal = {
      errorCode: 'REPOSITORY_MALFORMED_DOCUMENT',
      path: 'locations/loc-center',
      reason: 'timeZone',
    };
    const answer = checkDefaultLocation({
      domain: fakeDomain({ guardFor: () => ({ ok: false, error: refusal }) }),
      stored: LOCATION,
    });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.match(answer.detail, /refused by the read guard/);
    assert.deepEqual(answer.lines, [
      'REPOSITORY_MALFORMED_DOCUMENT path="locations/loc-center" reason="timeZone"',
    ]);
  });
});

describe('P2 · the TTL policies', () => {
  it('reads a field name as its group and path', () => {
    assert.equal(fieldKeyOf(`${PREFIX}/otps/fields/purgeAt`), 'otps/purgeAt');
  });

  it('passes when every declared policy is ACTIVE', () => {
    const answer = checkTtlPolicies({
      declared: DECLARED,
      listed: TTL_GROUPS.map((group) => ttlField(group)),
    });
    assert.equal(answer.verdict, Verdict.Pass);
    assert.equal(answer.detail, '7 of 7 TTL policies ACTIVE');
    assert.deepEqual(answer.lines, []);
  });

  it('fails on a policy that is not ACTIVE, and on one never deployed, naming each', () => {
    const listed = TTL_GROUPS.filter((group) => group !== 'otps').map((group) =>
      ttlField(
        group,
        group === 'capacity'
          ? 'CREATING'
          : group === 'barberBusy'
            ? 'NEEDS_REPAIR'
            : 'ACTIVE',
      ),
    );
    const answer = checkTtlPolicies({ declared: DECLARED, listed });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.equal(answer.detail, '4 of 7 TTL policies ACTIVE');
    assert.equal(answer.lines.length, 3);
    assert.match(answer.lines[0], /^otps\/purgeAt has no TTL policy/);
    assert.match(answer.lines[1], /^barberBusy\/purgeAt is NEEDS_REPAIR — /);
    assert.match(answer.lines[2], /^capacity\/purgeAt is CREATING — /);
  });

  it('lists a policy the file does not declare as INFO, which fails nothing', () => {
    const answer = checkTtlPolicies({
      declared: DECLARED,
      listed: [
        ...TTL_GROUPS.map((group) => ttlField(group)),
        ttlField('auditLog'),
      ],
    });
    assert.equal(answer.verdict, Verdict.Pass);
    assert.deepEqual(answer.lines, [
      'INFO  auditLog/purgeAt (ACTIVE) is not in firestore.indexes.json',
    ]);
  });

  it('fails when the file declares no policy at all', () => {
    assert.equal(
      checkTtlPolicies({ declared: { indexes: [] }, listed: [] }).verdict,
      Verdict.Fail,
    );
  });
});

describe('P3 · the composite indexes', () => {
  it('matches a deployed index to its entry despite the __name__ tiebreak, and never across a field order', () => {
    const [contains, positions] = DECLARED.indexes;
    assert.equal(sameIndex(listedIndex(contains), contains), true);
    assert.equal(sameIndex(listedIndex(positions), positions), true);
    assert.equal(sameIndex(listedIndex(positions), contains), false);
    const flipped = {
      ...positions,
      fields: [
        { fieldPath: 'positionStatus', order: 'ASCENDING' },
        { fieldPath: 'sortOrder', order: 'ASCENDING' },
      ],
    };
    assert.equal(sameIndex(listedIndex(flipped), positions), false);
  });

  it('passes when every declared composite is READY', () => {
    const answer = checkComposites({
      declared: DECLARED,
      listed: DECLARED.indexes.map((spec) => listedIndex(spec)),
    });
    assert.equal(answer.verdict, Verdict.Pass);
    assert.equal(answer.detail, '2 of 2 composites READY');
  });

  it('fails on a composite that is not READY, and on one not deployed', () => {
    const [contains, positions] = DECLARED.indexes;
    const building = checkComposites({
      declared: DECLARED,
      listed: [listedIndex(contains), listedIndex(positions, 'CREATING')],
    });
    assert.equal(building.verdict, Verdict.Fail);
    assert.equal(building.detail, '1 of 2 composites READY');
    assert.deepEqual(building.lines, [
      'positions: positionStatus asc, sortOrder desc is CREATING — still building — wait and run again',
    ]);
    const missing = checkComposites({
      declared: DECLARED,
      listed: [listedIndex(positions)],
    });
    assert.equal(missing.verdict, Verdict.Fail);
    assert.match(
      missing.lines[0],
      /^appointments: busyKeys contains, bookingStatus asc — not deployed/,
    );
  });

  it('lists an index the file dropped as an INFO prune candidate (OR-36), which fails nothing', () => {
    const dropped = {
      collectionGroup: 'services',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'categoryId', order: 'ASCENDING' },
        { fieldPath: 'sortOrder', order: 'ASCENDING' },
      ],
    };
    const answer = checkComposites({
      declared: DECLARED,
      listed: [
        ...DECLARED.indexes.map((spec) => listedIndex(spec)),
        listedIndex(dropped),
      ],
    });
    assert.equal(answer.verdict, Verdict.Pass);
    assert.deepEqual(answer.lines, [
      'INFO  not in firestore.indexes.json, a prune candidate (runbook §3 step 6): services: categoryId asc, sortOrder asc',
    ]);
  });
});

describe('P4 · the built bundle', () => {
  const dist = 'dist/apps/web/browser';

  it('passes on a build that names the project and carries no placeholder', () => {
    const answer = checkBundle({
      dist,
      projectId: PROJECT,
      scripts: [
        { path: 'main.js', text: `x={projectId:"${PROJECT}"}` },
        { path: 'chunk.js', text: 'y=1' },
      ],
    });
    assert.equal(answer.verdict, Verdict.Pass);
  });

  it('fails on a REPLACE_ME bundle, naming the file', () => {
    const answer = checkBundle({
      dist,
      projectId: PROJECT,
      scripts: [
        {
          path: 'main.js',
          text: 'x={apiKey:"REPLACE_ME",projectId:"REPLACE_ME"}',
        },
      ],
    });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.equal(answer.lines.length, 2);
    assert.match(answer.lines[0], /^main\.js carries REPLACE_ME/);
    assert.match(answer.lines[1], /^no script names "creativo-prod"/);
  });

  it('fails on a build of another project, and on no build at all', () => {
    assert.equal(
      checkBundle({
        dist,
        projectId: PROJECT,
        scripts: [{ path: 'main.js', text: 'x={projectId:"creativo-stage"}' }],
      }).verdict,
      Verdict.Fail,
    );
    const none = checkBundle({ dist, projectId: PROJECT, scripts: [] });
    assert.equal(none.verdict, Verdict.Fail);
    assert.deepEqual(none.lines, ['build the site first: pnpm nx build web']);
  });
});

describe('P5 · the callables host', () => {
  it('passes when connect-src names exactly the project’s host', () => {
    assert.equal(
      checkConnectSrc({ config: firebaseJson([HOST]), projectId: PROJECT })
        .verdict,
      Verdict.Pass,
    );
  });

  it('fails on the placeholder’s host, on a second host, and on no policy', () => {
    const placeholder =
      'https://us-central1-creativo-replace-me.cloudfunctions.net';
    for (const callables of [[placeholder], [HOST, placeholder], []]) {
      assert.equal(
        checkConnectSrc({ config: firebaseJson(callables), projectId: PROJECT })
          .verdict,
        Verdict.Fail,
        callables.join(' '),
      );
    }
    assert.equal(
      checkConnectSrc({ config: { hosting: [] }, projectId: PROJECT }).verdict,
      Verdict.Fail,
    );
  });
});

describe('P6 · the environment', () => {
  it('passes on a real project with no emulator variable', () => {
    const answer = checkEnvironment({
      env: { HOME: '/home/ops', GCLOUD_PROJECT: PROJECT },
      projectId: PROJECT,
    });
    assert.equal(answer.verdict, Verdict.Pass);
  });

  it('fails on the placeholder project, a demo project, an id no project has, and none', () => {
    for (const projectId of [
      'creativo-replace-me',
      'demo-creativo-test',
      'Creativo Prod',
      null,
    ]) {
      assert.equal(
        checkEnvironment({ env: {}, projectId }).verdict,
        Verdict.Fail,
        String(projectId),
      );
    }
  });

  it('fails on every emulator variable that is set, naming each', () => {
    const answer = checkEnvironment({
      env: {
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FUNCTIONS_EMULATOR: '',
      },
      projectId: PROJECT,
    });
    assert.equal(answer.verdict, Verdict.Fail);
    assert.deepEqual(answer.lines, [
      'FIREBASE_AUTH_EMULATOR_HOST is set — unset every emulator variable first',
      'FIRESTORE_EMULATOR_HOST is set — unset every emulator variable first',
    ]);
  });
});

describe('runPreflight', () => {
  const env = { GCLOUD_PROJECT: PROJECT };

  it('runs all six checks for the web scope, and four for the functions scope', async () => {
    assert.deepEqual(Object.keys(CHECKS), SCOPES.web);
    assert.deepEqual(SCOPES.functions, ['P1', 'P2', 'P3', 'P6']);
    const web = await runPreflight({
      scope: 'web',
      projectId: PROJECT,
      env,
      read: fakeReaders().read,
    });
    assert.deepEqual(
      web.map((entry) => [entry.check, entry.verdict]),
      SCOPES.web.map((check) => [check, Verdict.Pass]),
    );
    assert.equal(exitCodeOf(web), 0);
    const { read, calls } = fakeReaders();
    const functions = await runPreflight({
      scope: 'functions',
      projectId: PROJECT,
      env,
      read,
    });
    assert.deepEqual(
      functions.map((entry) => entry.check),
      SCOPES.functions,
    );
    assert.equal(calls.includes('bundle'), false);
    assert.equal(calls.includes('config'), false);
  });

  it('reads nothing of the project when P6 fails: P1–P3 SKIP, and the run fails', async () => {
    const { read, calls } = fakeReaders();
    const rows = await runPreflight({
      scope: 'functions',
      projectId: 'creativo-replace-me',
      env: {},
      read,
    });
    assert.deepEqual(
      rows.map((entry) => entry.verdict),
      [Verdict.Skip, Verdict.Skip, Verdict.Skip, Verdict.Fail],
    );
    assert.deepEqual(calls, []);
    assert.equal(exitCodeOf(rows), 1);
  });

  it('fails the check whose read throws, with the credentials hint, and keeps the others', async () => {
    const { read } = fakeReaders({
      indexes: async () => {
        throw new Error('Could not load the default credentials');
      },
    });
    const rows = await runPreflight({
      scope: 'web',
      projectId: PROJECT,
      env,
      read,
    });
    const p3 = rows.find((entry) => entry.check === 'P3');
    assert.equal(p3.verdict, Verdict.Fail);
    assert.match(p3.detail, /^cannot read: Could not load/);
    assert.match(p3.lines[0], /gcloud auth application-default login/);
    assert.equal(
      rows.filter((entry) => entry.verdict === Verdict.Pass).length,
      5,
    );
    assert.equal(exitCodeOf(rows), 1);
    // A read the credentials do not explain carries no credentials hint.
    const broken = await runPreflight({
      scope: 'functions',
      projectId: PROJECT,
      env,
      read: fakeReaders({
        declared: async () => {
          throw new Error('Unexpected token } in JSON at position 4');
        },
      }).read,
    });
    const p2 = broken.find((entry) => entry.check === 'P2');
    assert.equal(p2.verdict, Verdict.Fail);
    assert.deepEqual(p2.lines, []);
  });

  it('prints one row per check, its failure lines under it, and the verdict line', () => {
    const table = renderTable({
      projectId: PROJECT,
      scope: 'functions',
      rows: [
        { check: 'P1', verdict: Verdict.Pass, detail: 'ok', lines: [] },
        {
          check: 'P2',
          verdict: Verdict.Fail,
          detail: '6 of 7 TTL policies ACTIVE',
          lines: ['capacity/purgeAt is CREATING'],
        },
      ],
    });
    assert.match(table, /^ {2}P1 {5}PASS {4}/m);
    assert.match(table, /^ {2}P2 {5}FAIL {4}/m);
    assert.match(table, /^ +capacity\/purgeAt is CREATING$/m);
    assert.match(table, /FAIL — P2 did not pass; the deploy stops here/);
  });
});

describe('preflight · the command', () => {
  /** Swallows what the command prints. */
  const quiet = () => undefined;

  it('takes the project from --project, else $GCLOUD_PROJECT, else .firebaserc', () => {
    const rc = () => 'creativo-replace-me';
    assert.equal(
      optionsOf(['--project', 'creativo-a'], { GCLOUD_PROJECT: 'b' }, rc)
        .projectId,
      'creativo-a',
    );
    assert.equal(
      optionsOf(['--scope', 'functions'], { GCLOUD_PROJECT: 'creativo-b' }, rc)
        .projectId,
      'creativo-b',
    );
    assert.equal(optionsOf([], {}, rc).projectId, 'creativo-replace-me');
    assert.equal(optionsOf([], {}, rc).scope, 'web');
  });

  it('exits 2 on an unknown scope or option, reading nothing', async () => {
    for (const args of [['--scope', 'rules'], ['--force']]) {
      let read = false;
      const code = await preflight({
        args,
        env: {},
        readersFor: () => {
          read = true;
          return fakeReaders().read;
        },
        firebasercDefault: () => null,
        print: quiet,
        warn: quiet,
      });
      assert.equal(code, 2, args.join(' '));
      assert.equal(read, false);
    }
  });

  it('runs no check under CREATIVO_SKIP_PREFLIGHT=1, warns loudly and exits 0', async () => {
    const warnings = [];
    let read = false;
    const code = await preflight({
      args: ['--scope', 'functions', '--project', 'creativo-replace-me'],
      env: { CREATIVO_SKIP_PREFLIGHT: '1' },
      readersFor: () => {
        read = true;
        return fakeReaders().read;
      },
      firebasercDefault: () => null,
      print: quiet,
      warn: (text) => warnings.push(text),
    });
    assert.equal(code, 0);
    assert.equal(read, false);
    assert.match(
      warnings.join('\n'),
      /CREATIVO_SKIP_PREFLIGHT=1 — the production preflight did NOT run/,
    );
  });

  it('exits 1 on a failing check and 0 on a healthy project, printing the table', async () => {
    const printed = [];
    const run = (overrides) =>
      preflight({
        args: ['--project', PROJECT],
        env: {},
        readersFor: () => fakeReaders(overrides).read,
        firebasercDefault: () => null,
        print: (text) => printed.push(text),
        warn: quiet,
      });
    assert.equal(await run({}), 0);
    assert.equal(await run({ location: async () => null }), 1);
    assert.match(printed[1], /P1 {5}FAIL/);
  });
});

describe('the deploy wiring', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

  it('runs the preflight as the hosting predeploy (all checks) and last in the functions predeploy (P1–P3, P6), on the deployed project', () => {
    const config = json('firebase.json');
    const web = config.hosting.find((entry) => entry.target === 'web');
    assert.deepEqual(web.predeploy, [
      'node tools/verify/preflight/preflight.mjs --scope web --project $GCLOUD_PROJECT',
    ]);
    assert.equal(
      config.functions.predeploy.at(-1),
      'node tools/verify/preflight/preflight.mjs --scope functions --project $GCLOUD_PROJECT',
    );
  });

  it('names it `pnpm run preflight`', () => {
    assert.equal(
      json('package.json').scripts.preflight,
      'node tools/verify/preflight/preflight.mjs',
    );
  });
});
