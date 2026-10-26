// node --test tools/verify/preflight/preflight.spec.mjs
//
// The production preflight's checks over fakes (owner ruling OR-35): what a
// project read, the indexes file, a build, firebase.json and the functions'
// source would answer — never a network, a credential or the seed bundle. The domain is a fake of
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
  checkEmulatorOnly,
  checkTtlPolicies,
  exitCodeOf,
  fieldKeyOf,
  functionsSourceUnder,
  optionsOf,
  preflight,
  renderTable,
  runPreflight,
  sameIndex,
  skipBanner,
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

/**
 * The functions' source root; the console sender's adapter, tagged
 * `@emulatorOnly` as the real one is; and a composition root wiring it as
 * the OTP crypto is wired.
 */
const FUNCTIONS = 'apps/functions/src';
const ADAPTER_PATH = `${FUNCTIONS}/adapters/console-otp-sender.adapter.ts`;
const adapterExporting = (name) => ({
  path: ADAPTER_PATH,
  text: [
    '/**',
    " * The emulator's login-OTP sender: the code goes to the log.",
    ' *',
    ' * @emulatorOnly The production preflight refuses it outside onEmulator().',
    ' */',
    `export const ${name} = (log: Log): OtpDeliveryPorts => ({ sendOtp: async () => ok });`,
  ].join('\n'),
});
const ADAPTER = adapterExporting('consoleOtpSender');
const IMPORT =
  "import { consoleOtpSender } from './adapters/console-otp-sender.adapter';";
const GATED_ROOT = [
  IMPORT,
  'const identityPorts = once(() => ({',
  '  ...(onEmulator()',
  '    ? consoleOtpSender(telemetry.log)',
  '    : transactionalOtpSender(apiKey.value())),',
  '}));',
].join('\n');

/** The tagged adapter beside a composition root of `lines`. */
const tree = (...lines) => [
  ADAPTER,
  { path: `${FUNCTIONS}/main.ts`, text: lines.join('\n') },
];

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
    functionsSource: counted('functionsSource', () => ({
      root: FUNCTIONS,
      sources: tree(GATED_ROOT),
    })),
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

describe('P7 · the emulator-only adapters', () => {
  const main = `${FUNCTIONS}/main.ts`;
  const judge = (sources) => checkEmulatorOnly({ root: FUNCTIONS, sources });
  /** The failure line of a use at `line` of main.ts. */
  const outside = (line, name = 'consoleOtpSender') =>
    `${main}:${line} uses ${name} (@emulatorOnly, ${ADAPTER_PATH}) outside the emulator`;

  it('passes when every use of an @emulatorOnly export sits behind onEmulator(), as the OTP crypto does', () => {
    const ternary = judge(tree(GATED_ROOT));
    assert.equal(ternary.verdict, Verdict.Pass);
    assert.equal(
      ternary.detail,
      'consoleOtpSender: the one use behind onEmulator()',
    );
    const block = judge(
      tree(
        IMPORT,
        'let sender = transactionalOtpSender(apiKey.value());',
        'if ((onEmulator())) {',
        '  sender = consoleOtpSender(telemetry.log);',
        '}',
        'const ports = onEmulator() ? { ...consoleOtpSender(log) } : sender;',
      ),
    );
    assert.equal(block.verdict, Verdict.Pass);
    assert.equal(
      block.detail,
      'consoleOtpSender: all 2 uses behind onEmulator()',
    );
  });

  it('judges uses only: the declaration, an import, a re-export, a type position, a comment and a string construct nothing', () => {
    const answer = judge([
      ADAPTER,
      {
        path: `${FUNCTIONS}/adapters/index.ts`,
        text: "export { consoleOtpSender } from './console-otp-sender.adapter';",
      },
      {
        path: main,
        text: [
          IMPORT,
          'type Sender = ReturnType<typeof consoleOtpSender>;',
          '// ...consoleOtpSender(telemetry.log) until the provider lands',
          "log('info', 'consoleOtpSender(telemetry.log)');",
          'const ports = { ...transactionalOtpSender(apiKey.value()) };',
        ].join('\n'),
      },
    ]);
    assert.equal(answer.verdict, Verdict.Pass);
    assert.equal(answer.detail, 'consoleOtpSender: never used');
  });

  it('anchors on the tag, not on a name: an untagged export is never judged', () => {
    const answer = judge([
      {
        path: ADAPTER_PATH,
        text: 'export const consoleOtpSender = () => ({});',
      },
      {
        path: main,
        text: `${IMPORT}\nconst ports = { ...consoleOtpSender(log) };`,
      },
    ]);
    assert.equal(answer.verdict, Verdict.Pass);
    assert.equal(
      answer.detail,
      `no @emulatorOnly export in 2 files under ${FUNCTIONS}`,
    );
  });

  it('fails on the adapter wired outright — today’s composition root — naming the line and the adapter, the way out last', () => {
    const answer = judge(
      tree(
        IMPORT,
        'const identityPorts = once(() => ({',
        '  ...consoleOtpSender(telemetry.log),',
        '}));',
      ),
    );
    assert.equal(answer.verdict, Verdict.Fail);
    assert.equal(
      answer.detail,
      'an emulator-only adapter is not provably behind onEmulator()',
    );
    assert.deepEqual(answer.lines.slice(0, -1), [outside(3)]);
    assert.match(
      answer.lines.at(-1),
      /onEmulator\(\) \? <emulator adapter> : <deployed adapter>, as the OTP crypto is; .* docs\/production-deploy\.md §1/,
    );
  });

  it('follows a renamed export, an aliased import, a barrel re-export, a namespace and a shorthand back to the tagged declaration', () => {
    const ungated = (sources) => judge(sources).lines.slice(0, -1);
    assert.deepEqual(
      ungated([
        adapterExporting('consoleOtpDeliveryPorts'),
        {
          path: main,
          text: [
            "import { consoleOtpDeliveryPorts } from './adapters/console-otp-sender.adapter';",
            'const ports = { ...consoleOtpDeliveryPorts(log) };',
          ].join('\n'),
        },
      ]),
      [outside(2, 'consoleOtpDeliveryPorts')],
    );
    assert.deepEqual(
      ungated(
        tree(
          "import { consoleOtpSender as loginOtpSender } from './adapters/console-otp-sender.adapter';",
          'const ports = { ...loginOtpSender(log) };',
        ),
      ),
      [outside(2)],
    );
    assert.deepEqual(
      ungated([
        ...tree(
          "import { otpSenderPorts } from './adapters';",
          'const ports = { ...otpSenderPorts(log) };',
        ),
        {
          path: `${FUNCTIONS}/adapters/index.ts`,
          text: "export { consoleOtpSender as otpSenderPorts } from './console-otp-sender.adapter';",
        },
      ]),
      [outside(2)],
    );
    assert.deepEqual(
      ungated(
        tree(
          "import * as dev from './adapters/console-otp-sender.adapter';",
          'const ports = { ...dev.consoleOtpSender(log) };',
        ),
      ),
      [outside(2)],
    );
    assert.deepEqual(
      ungated(tree(IMPORT, 'const factories = { consoleOtpSender };')),
      [outside(2)],
    );
  });

  it('judges a run-time load of an emulator-only module at the load, and a default export at its importers', () => {
    const load = (line) =>
      `${main}:${line} loads ${ADAPTER_PATH} (@emulatorOnly consoleOtpSender) outside the emulator — import it statically, so each use can be followed`;
    const loads = judge(
      tree(
        "const a = async () => (await import('./adapters/console-otp-sender.adapter')).consoleOtpSender(log);",
        "const { consoleOtpSender } = require('./adapters/console-otp-sender.adapter');",
        "const c = onEmulator() ? import('./adapters/console-otp-sender.adapter') : import('./adapters/transactional');",
      ),
    );
    assert.equal(loads.verdict, Verdict.Fail);
    assert.deepEqual(loads.lines.slice(0, -1), [load(1), load(2)]);
    const byDefault = {
      path: ADAPTER_PATH,
      text: '/** @emulatorOnly */\nconst consoleOtpSender = (log) => ({});\nexport default consoleOtpSender;',
    };
    const importing = (use) => [
      byDefault,
      {
        path: main,
        text: `import sender from './adapters/console-otp-sender.adapter';\n${use}`,
      },
    ];
    assert.equal(
      judge(importing('const p = onEmulator() ? sender(log) : real();')).detail,
      'consoleOtpSender: the one use behind onEmulator()',
    );
    assert.deepEqual(
      judge(importing('const p = sender(log);')).lines.slice(0, -1),
      [outside(2)],
    );
  });

  it('judges a lazy load of a module that only re-exports one, and refuses a load it cannot name', () => {
    const barrel = {
      path: `${FUNCTIONS}/adapters/index.ts`,
      text: "export * from './console-otp-sender.adapter';",
    };
    const answer = judge([
      ...tree(
        "const a = async () => { const { consoleOtpSender } = await import('./adapters'); return consoleOtpSender(log); };",
        'const b = (kind) => import(`./adapters/${kind}-otp-sender.adapter`);',
        "const c = onEmulator() ? import('./adapters') : import('./adapters/transactional');",
      ),
      barrel,
    ]);
    assert.deepEqual(answer.lines.slice(0, -1), [
      `${main}:1 loads ${FUNCTIONS}/adapters/index.ts (@emulatorOnly consoleOtpSender) outside the emulator — import it statically, so each use can be followed`,
      `${main}:2 loads a module named at run time outside the emulator — P7 cannot follow it; name it with a string literal`,
    ]);
  });

  it('never lets a tag drop out: one in an earlier doc block still anchors, and a tag on anything but an exported const or function fails', () => {
    const adapter = (text) => [
      { path: ADAPTER_PATH, text },
      {
        path: main,
        text: `${IMPORT}\nconst ports = { ...consoleOtpSender(log) };`,
      },
    ];
    const earlierBlock = judge(
      adapter(
        '/** @emulatorOnly */\n/**\n * The emulator sender.\n */\nexport const consoleOtpSender = (log) => ({});',
      ),
    );
    assert.deepEqual(earlierBlock.lines.slice(0, -1), [outside(2)]);
    const drifted = judge(
      adapter(
        [
          '/** @emulatorOnly */',
          "type Channel = 'email' | 'sms';",
          'export const consoleOtpSender = (log) => ({});',
          '/** @emulatorOnly */',
          "const PREFIX = '[otp]';",
          'export const senders = {',
          '  /** @emulatorOnly */',
          '  console: (log) => ({}),',
          '};',
          '/** @emulatorOnly */',
          'export default (log) => ({});',
        ].join('\n'),
      ),
    );
    assert.equal(drifted.verdict, Verdict.Fail);
    assert.deepEqual(drifted.lines.slice(0, -1), [
      `${ADAPTER_PATH}:2 tags a TypeAliasDeclaration @emulatorOnly — the tag anchors only on an exported top-level const or function`,
      `${ADAPTER_PATH}:5 tags PREFIX @emulatorOnly, which its module does not export — move the tag onto the export`,
      `${ADAPTER_PATH}:8 tags a PropertyAssignment @emulatorOnly — the tag anchors only on an exported top-level const or function`,
      `${ADAPTER_PATH}:11 tags an ExportAssignment @emulatorOnly — the tag anchors only on an exported top-level const or function`,
    ]);
  });

  it('lets one tagged declaration use another — it is judged where it is used in turn', () => {
    const crypto = {
      path: `${FUNCTIONS}/adapters/otp-crypto.adapter.ts`,
      text: [
        '/** @emulatorOnly */',
        "export const OTP_FIXED_CODE = '123456';",
        '/** @emulatorOnly */',
        'export const fixedCodeOtpCryptoPorts = () => ({ nextCode: () => OTP_FIXED_CODE });',
      ].join('\n'),
    };
    const root = (use) => ({
      path: main,
      text: `import { fixedCodeOtpCryptoPorts } from './adapters/otp-crypto.adapter';\n${use}`,
    });
    const gated = judge([
      crypto,
      root('const p = onEmulator() ? fixedCodeOtpCryptoPorts() : real();'),
    ]);
    assert.equal(gated.verdict, Verdict.Pass);
    assert.equal(
      gated.detail,
      'OTP_FIXED_CODE, fixedCodeOtpCryptoPorts: the one use behind onEmulator()',
    );
    assert.deepEqual(
      judge([crypto, root('const p = fixedCodeOtpCryptoPorts();')]).lines.slice(
        0,
        -1,
      ),
      [
        `${main}:2 uses fixedCodeOtpCryptoPorts (@emulatorOnly, ${FUNCTIONS}/adapters/otp-crypto.adapter.ts) outside the emulator`,
      ],
    );
  });

  it('fails on the deployed branch, a negated or another gate, a gate with an argument, an else-block and an alias, naming each', () => {
    const answer = judge(
      tree(
        IMPORT,
        'const a = onEmulator() ? fixed() : consoleOtpSender(log);',
        'const b = !onEmulator() ? consoleOtpSender(log) : real();',
        'const c = isEmulator() ? consoleOtpSender(log) : real();',
        'const d = onEmulator(true) ? consoleOtpSender(log) : real();',
        'if (onEmulator()) { real(); } else { consoleOtpSender(log); }',
        'const sender = consoleOtpSender;',
      ),
    );
    assert.equal(answer.verdict, Verdict.Fail);
    assert.deepEqual(
      answer.lines.slice(0, -1),
      [2, 3, 4, 5, 6, 7].map((line) => outside(line)),
    );
  });

  it('fails when there is no functions source to judge', () => {
    const answer = judge([]);
    assert.equal(answer.verdict, Verdict.Fail);
    assert.equal(answer.detail, `no functions source under ${FUNCTIONS}`);
  });
});

describe('runPreflight', () => {
  const env = { GCLOUD_PROJECT: PROJECT };

  it('runs P1–P6 for the web scope and P1–P3, P6, P7 for the functions scope — every check in one of them', async () => {
    assert.deepEqual(SCOPES.web, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    assert.deepEqual(SCOPES.functions, ['P1', 'P2', 'P3', 'P6', 'P7']);
    assert.deepEqual(
      [...new Set([...SCOPES.web, ...SCOPES.functions])].sort(),
      Object.keys(CHECKS),
    );
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
      functions.map((entry) => [entry.check, entry.verdict]),
      SCOPES.functions.map((check) => [check, Verdict.Pass]),
    );
    assert.equal(calls.includes('bundle'), false);
    assert.equal(calls.includes('config'), false);
  });

  it('reads nothing of the project when P6 fails: P1–P3 SKIP, P7 still judges the source, and the run fails', async () => {
    const { read, calls } = fakeReaders();
    const rows = await runPreflight({
      scope: 'functions',
      projectId: 'creativo-replace-me',
      env: {},
      read,
    });
    assert.deepEqual(
      rows.map((entry) => entry.verdict),
      [Verdict.Skip, Verdict.Skip, Verdict.Skip, Verdict.Fail, Verdict.Pass],
    );
    assert.deepEqual(calls, ['functionsSource']);
    assert.equal(exitCodeOf(rows), 1);
  });

  it('fails the functions deploy on the console sender wired outright, whatever the project reads', async () => {
    const rows = await runPreflight({
      scope: 'functions',
      projectId: PROJECT,
      env,
      read: fakeReaders({
        functionsSource: async () => ({
          root: FUNCTIONS,
          sources: tree(IMPORT, 'const ports = { ...consoleOtpSender(log) };'),
        }),
      }).read,
    });
    assert.deepEqual(
      rows.map((entry) => [entry.check, entry.verdict]),
      [
        ['P1', Verdict.Pass],
        ['P2', Verdict.Pass],
        ['P3', Verdict.Pass],
        ['P6', Verdict.Pass],
        ['P7', Verdict.Fail],
      ],
    );
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

  it('names in the skip banner what the scope would have proved, and the command that proves it', () => {
    const functions = skipBanner({ projectId: PROJECT, scope: 'functions' });
    assert.match(
      functions,
      /Nothing proved the default location, the TTL policies, the indexes, the environment or the emulator-only adapters of creativo-prod\./,
    );
    assert.match(
      functions,
      /Run `pnpm run preflight --scope functions --project creativo-prod` after this deploy\./,
    );
    const web = skipBanner({ projectId: PROJECT, scope: 'web' });
    assert.match(
      web,
      /the bundle, the CSP or the environment of creativo-prod\./,
    );
    assert.doesNotMatch(web, /emulator-only/);
    assert.match(
      skipBanner({ projectId: null, scope: 'web' }),
      /--scope web --project <id>` after this deploy/,
    );
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

  it('runs the preflight as the hosting predeploy (P1–P6) and last in the functions predeploy (P1–P3, P6, P7), on the deployed project', () => {
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

  // The launch blocker, read off the repository: P7 resolves the very files
  // the functions build compiles. This pin flips to PASS in the change that
  // wires a transactional sender (docs/production-deploy.md §1, "Sign-in:
  // the OTP sender") — update it there, with that checklist item.
  it('P7 refuses today’s functions on main.ts’s console sender alone, and passes once that one line is gated — both OTP adapters and the fixed code tagged', () => {
    const sources = functionsSourceUnder(join(root, FUNCTIONS));
    assert.ok(sources.some(({ path }) => path.endsWith('/main.ts')));
    assert.equal(
      sources.some(({ path }) =>
        /\.(spec|test)\.ts$|functions\/src\/test-support\//.test(path),
      ),
      false,
    );
    const today = checkEmulatorOnly({ root: FUNCTIONS, sources });
    assert.equal(today.verdict, Verdict.Fail);
    assert.equal(today.lines.length, 2);
    assert.match(
      today.lines[0],
      /apps\/functions\/src\/main\.ts:\d+ uses consoleOtpSender \(@emulatorOnly, .*apps\/functions\/src\/adapters\/console-otp-sender\.adapter\.ts\) outside the emulator$/,
    );
    const wired = '...consoleOtpSender(telemetry.log),';
    const main = sources.find(({ path }) => path.endsWith('/main.ts'));
    assert.ok(main.text.includes(wired));
    const gated = sources.map((file) =>
      file === main
        ? {
            ...file,
            text: file.text.replace(
              wired,
              '...(onEmulator() ? consoleOtpSender(telemetry.log) : transactionalOtpSender()),',
            ),
          }
        : file,
    );
    const tomorrow = checkEmulatorOnly({ root: FUNCTIONS, sources: gated });
    assert.equal(tomorrow.verdict, Verdict.Pass);
    assert.equal(
      tomorrow.detail,
      'consoleOtpSender, OTP_FIXED_CODE, fixedCodeOtpCryptoPorts: all 2 uses behind onEmulator()',
    );
  });

  it('names it `pnpm run preflight`', () => {
    assert.equal(
      json('package.json').scripts.preflight,
      'node tools/verify/preflight/preflight.mjs',
    );
  });
});
