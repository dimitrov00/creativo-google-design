// node --test tools/release/callable-invokers.spec.mjs
//
// The deploy's invoker guard over an in-memory project: a private callable
// is made public (what firebase-tools grants only on create), a public one is
// left alone, any other function open to the public fails the step, and a
// dry run changes nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CALLABLE_LABEL,
  INVOKER_ROLE,
  ensureInvokers,
  isCallable,
  main,
  openInvokersOf,
  planInvokers,
  serviceOf,
  withPublicInvoker,
} from './callable-invokers.mjs';
import { LEGACY_PROJECT_IDS } from './legacy-projects.mjs';

const PROJECT = 'creativo-v2-staging';
const REGION = 'europe-west8';
const RUNTIME = `serviceAccount:creativo-functions@${PROJECT}.iam.gserviceaccount.com`;

/** A deployed function as the Cloud Functions v2 API lists it. */
function fn(id, { callable = false, service = id.toLowerCase() } = {}) {
  return {
    name: `projects/${PROJECT}/locations/${REGION}/functions/${id}`,
    labels: {
      'deployment-tool': 'cli-firebase',
      ...(callable ? { [CALLABLE_LABEL]: 'true' } : {}),
    },
    serviceConfig: service
      ? {
          service: `projects/${PROJECT}/locations/${REGION}/services/${service}`,
        }
      : {},
  };
}

/** A service policy whose invoker binding names `members` (none: no binding). */
function policy(members = [], extra = []) {
  return {
    etag: 'BwZgsdVMkkM=',
    version: 1,
    bindings: [
      ...extra,
      ...(members.length ? [{ role: INVOKER_ROLE, members }] : []),
    ],
  };
}

/** An in-memory project: functions and their services' policies; records writes. */
function project(entries, { refuse = new Set() } = {}) {
  const policies = new Map(
    entries
      .filter(({ fn: f }) => serviceOf(f))
      .map(({ fn: f, policy: p }) => [serviceOf(f), p]),
  );
  const writes = [];
  return {
    writes,
    api: {
      listFunctions: async () => entries.map(({ fn: f }) => f),
      getPolicy: async (service) => structuredClone(policies.get(service)),
      setPolicy: async (service, next) => {
        if (refuse.has(service))
          throw new Error('HTTP 403 — permission denied');
        writes.push({ service, policy: next });
        policies.set(service, next);
        return next;
      },
    },
  };
}

describe('the policy helpers', () => {
  it('knows a callable by firebase-tools’ label, and its service by the config', () => {
    assert.equal(isCallable(fn('listTeam', { callable: true })), true);
    assert.equal(isCallable(fn('auditBarbersChanges')), false);
    assert.equal(
      serviceOf(fn('listTeam')),
      `projects/${PROJECT}/locations/${REGION}/services/listteam`,
    );
    assert.equal(serviceOf(fn('broken', { service: null })), null);
  });

  it('reads only the unconditional invoker binding’s open members', () => {
    assert.deepEqual(openInvokersOf(policy(['allUsers', RUNTIME])), [
      'allUsers',
    ]);
    assert.deepEqual(openInvokersOf(policy([RUNTIME])), []);
    assert.deepEqual(openInvokersOf(policy()), []);
    assert.deepEqual(openInvokersOf(null), []);
    assert.deepEqual(
      openInvokersOf({
        bindings: [
          {
            role: INVOKER_ROLE,
            members: ['allUsers'],
            condition: {
              expression: 'request.time < timestamp("2030-01-01T00:00:00Z")',
            },
          },
          { role: 'roles/run.developer', members: ['allAuthenticatedUsers'] },
        ],
      }),
      [],
    );
  });

  it('adds allUsers to the invoker binding, keeping every other binding, the etag and the input', () => {
    const before = policy(
      [RUNTIME],
      [{ role: 'roles/run.developer', members: ['user:owner@example.com'] }],
    );
    const frozen = structuredClone(before);
    const after = withPublicInvoker(before);
    assert.deepEqual(before, frozen, 'the input is not changed');
    assert.equal(after.etag, before.etag);
    assert.equal(after.version, 1);
    assert.deepEqual(after.bindings, [
      { role: 'roles/run.developer', members: ['user:owner@example.com'] },
      { role: INVOKER_ROLE, members: [RUNTIME, 'allUsers'] },
    ]);
  });

  it('creates the invoker binding when there is none, and adds nothing twice', () => {
    assert.deepEqual(withPublicInvoker(policy()).bindings, [
      { role: INVOKER_ROLE, members: ['allUsers'] },
    ]);
    assert.deepEqual(withPublicInvoker({}).bindings, [
      { role: INVOKER_ROLE, members: ['allUsers'] },
    ]);
    const open = policy(['allUsers']);
    assert.deepEqual(withPublicInvoker(open).bindings, open.bindings);
  });
});

describe('planInvokers', () => {
  it('grants the private callables, leaves the public ones, and flags any other open function', () => {
    const plan = planInvokers([
      { fn: fn('listTeam', { callable: true }), policy: policy() },
      {
        fn: fn('commitBooking', { callable: true }),
        policy: policy(['allUsers']),
      },
      {
        fn: fn('setRoles', { callable: true }),
        policy: policy(['allAuthenticatedUsers']),
      },
      { fn: fn('sweepCapacityDaily'), policy: policy([RUNTIME]) },
      { fn: fn('auditBarbersChanges'), policy: policy() },
      {
        fn: fn('rebuildBusyOnAppointmentChange'),
        policy: policy(['allUsers']),
      },
      { fn: fn('ghost', { callable: true, service: null }), policy: null },
    ]);
    assert.deepEqual(
      plan.grant.map(({ name }) => name),
      ['listTeam', 'setRoles'],
    );
    assert.deepEqual(plan.exposed, [
      { name: 'rebuildBusyOnAppointmentChange', members: ['allUsers'] },
    ]);
    assert.deepEqual(plan.unserved, ['ghost']);
    assert.equal(plan.publicCallables, 1);
    assert.equal(plan.privateOthers, 2);
  });
});

describe('ensureInvokers', () => {
  const STAGING_ON_2026_11_20 = () => [
    { fn: fn('listTeam', { callable: true }), policy: policy() },
    { fn: fn('reportClientIssues', { callable: true }), policy: policy() },
    {
      fn: fn('commitBooking', { callable: true }),
      policy: policy(['allUsers']),
    },
    { fn: fn('sweepCapacityDaily'), policy: policy([RUNTIME]) },
    { fn: fn('auditBarbersChanges'), policy: policy() },
  ];

  it('makes each private callable public, once, and passes', async () => {
    const { api, writes } = project(STAGING_ON_2026_11_20());
    const { problems, lines } = await ensureInvokers({ api });
    assert.deepEqual(problems, []);
    assert.deepEqual(
      writes.map(({ service }) => service.split('/').at(-1)),
      ['listteam', 'reportclientissues'],
    );
    for (const { policy: written } of writes) {
      assert.deepEqual(openInvokersOf(written), ['allUsers']);
      assert.equal(
        written.etag,
        'BwZgsdVMkkM=',
        'the read etag guards the write',
      );
    }
    assert.equal(
      lines.at(-1),
      '3 of 3 callables public; 2 other function(s) private',
    );

    const again = await ensureInvokers({ api });
    assert.deepEqual(again.problems, []);
    assert.equal(writes.length, 2, 'a second run writes nothing');
  });

  it('never opens a trigger or a schedule, and fails when one is open', async () => {
    const { api, writes } = project([
      { fn: fn('listTeam', { callable: true }), policy: policy(['allUsers']) },
      {
        fn: fn('sweepCapacityDaily'),
        policy: policy([RUNTIME, 'allAuthenticatedUsers']),
      },
    ]);
    const { problems } = await ensureInvokers({ api });
    assert.equal(writes.length, 0);
    assert.deepEqual(problems, [
      'sweepCapacityDaily: not a callable, yet allAuthenticatedUsers may invoke it — only its runtime account should',
    ]);
  });

  it('fails on a callable with no service, and on a refused write, and still grants the rest', async () => {
    const entries = [
      { fn: fn('listTeam', { callable: true }), policy: policy() },
      { fn: fn('setRoles', { callable: true }), policy: policy() },
      { fn: fn('ghost', { callable: true, service: null }), policy: null },
    ];
    const { api, writes } = project(entries, {
      refuse: new Set([serviceOf(entries[1].fn)]),
    });
    const { problems, lines } = await ensureInvokers({ api });
    assert.equal(writes.length, 1);
    assert.deepEqual(problems, [
      'setRoles: could not be made public — HTTP 403 — permission denied',
      'ghost: a callable with no Cloud Run service — its deploy did not finish',
    ]);
    assert.equal(
      lines.at(-1),
      '1 of 3 callables public; 0 other function(s) private',
    );
  });

  it('reports and fails on a dry run, writing nothing', async () => {
    const { api, writes } = project(STAGING_ON_2026_11_20());
    const { problems, lines } = await ensureInvokers({ api, dryRun: true });
    assert.equal(writes.length, 0);
    assert.deepEqual(lines.slice(0, 2), [
      `would make listTeam public (${INVOKER_ROLE} allUsers)`,
      `would make reportClientIssues public (${INVOKER_ROLE} allUsers)`,
    ]);
    assert.deepEqual(problems, [
      '2 callable(s) are private (dry run: nothing changed)',
    ]);
  });
});

describe('main', () => {
  const run = async (args, api) => {
    const out = [];
    const err = [];
    const code = await main({
      args,
      api,
      print: (text) => out.push(text),
      warn: (text) => err.push(text),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('passes with every callable public, and says so', async () => {
    const { api } = project([
      { fn: fn('listTeam', { callable: true }), policy: policy(['allUsers']) },
    ]);
    const { code, out } = await run(['--project', PROJECT], api);
    assert.equal(code, 0);
    assert.match(
      out,
      /invokers: PASS — creativo-v2-staging: every callable answers the public/,
    );
  });

  it('exits 1 on a failed check and on an API that cannot be read', async () => {
    const { api } = project([
      { fn: fn('auditBarbersChanges'), policy: policy(['allUsers']) },
    ]);
    assert.equal((await run(['--project', PROJECT], api)).code, 1);
    const broken = {
      listFunctions: async () => {
        throw new Error('list the functions: HTTP 403 — permission denied');
      },
    };
    const { code, err } = await run(['--project', PROJECT], broken);
    assert.equal(code, 1);
    assert.match(
      err,
      /invokers: FAIL — creativo-v2-staging: list the functions: HTTP 403/,
    );
  });

  it('exits 2 without a project, on a malformed id and on a legacy project', async () => {
    for (const args of [
      [],
      ['--project', 'Not A Project'],
      ['--project', LEGACY_PROJECT_IDS[0]],
      ['--project', PROJECT, '--apply'],
    ]) {
      const { code, err } = await run(args, {});
      assert.equal(code, 2, args.join(' '));
      assert.match(err, /usage: node tools\/release\/callable-invokers\.mjs/);
    }
  });
});
