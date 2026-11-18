// node --test tools/verify/ops/ops-scripts.spec.mjs
//
// The platform-backstop scripts of tools/ops (audit-hardening WS-6): what
// each prints and — above all — that a run without --apply executes
// nothing. Every run here is a dry run under a stub `gcloud` first on PATH,
// which records any call; no run passes --apply. The metric and alert texts
// are held to the `LogEvent` dictionary, read as a file
// (libs/ecs-core/src/primitives/log-event.data.ts), so a renamed event
// cannot silently kill its metric (plan L-11).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { opsNamesOf } from '../preflight/preflight.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OPS = join(ROOT, 'tools', 'ops');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const SCRIPTS = readdirSync(OPS)
  .filter((name) => name.endsWith('.sh'))
  .sort();
/** The repository's GitHub settings (ADR 2026-11-18): `gh`, not gcloud, and no project. */
const GITHUB_SCRIPT = 'github-repo-settings.sh';
/** The scripts that address a Google Cloud project. */
const GCLOUD_SCRIPTS = SCRIPTS.filter((name) => name !== GITHUB_SCRIPT);
const ALERTS = readdirSync(join(OPS, 'alerts'))
  .filter((name) => name.endsWith('.yaml'))
  .sort();

/** RU-36's sink filter, verbatim. */
const SINK_FILTER =
  '(LOG_ID("cloudaudit.googleapis.com/activity") OR LOG_ID("cloudaudit.googleapis.com/data_access") OR (resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions")) AND NOT jsonPayload.clientIssueKind:*';

/** Every value of the `LogEvent` dictionary, read off its source. */
function logEventValues() {
  const source = read('libs/ecs-core/src/primitives/log-event.data.ts');
  const body = /export const LogEvent = \{([\s\S]*?)\} as const;/.exec(source);
  assert.ok(
    body,
    'log-event.data.ts declares `export const LogEvent = { … } as const`',
  );
  const values = [
    ...body[1].matchAll(/^\s+[A-Z][A-Za-z]*:\s*'([^']*)',/gm),
  ].map((match) => match[1]);
  assert.ok(values.length >= 30, `read ${values.length} LogEvent values`);
  return new Set(values);
}

/** Every `jsonPayload.message:"…"` text in `text` — its quotes escaped (`\"`) inside a shell string too. */
const messageTexts = (text) =>
  [...text.matchAll(/jsonPayload\.message:\\?"([^"\\]*)\\?"/g)].map(
    (match) => match[1],
  );

let stubDir;
let marker;

/** One dry run of `script`: a clean environment, the stub gcloud and gh first on PATH. */
function dryRun(script, args = []) {
  const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };
  delete env.PROJECT_ID;
  const result = spawnSync('bash', [join(OPS, script), ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

before(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'ops-stub-'));
  marker = join(stubDir, 'gcloud-called');
  for (const tool of ['gcloud', 'gh']) {
    const stub = join(stubDir, tool);
    writeFileSync(stub, `#!/bin/sh\necho "$@" >> '${marker}'\nexit 97\n`);
    chmodSync(stub, 0o755);
  }
});

after(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe('tools/ops — every script, dry by default', () => {
  it('holds the six scripts and the eight alert policies the plans name', () => {
    assert.deepEqual(SCRIPTS, [
      'audit-logs.sh',
      'deploy-identity.sh',
      'firestore-backups.sh',
      'github-repo-settings.sh',
      'log-metrics.sh',
      'log-sink.sh',
    ]);
    assert.deepEqual(ALERTS, [
      'audit-actor-missing.yaml',
      'callable-failures.yaml',
      'client-issues.yaml',
      'documents-refused.yaml',
      'otp-codes-sent.yaml',
      'roles-sessions-not-revoked.yaml',
      'trigger-attempts.yaml',
      'trigger-failure-not-recorded.yaml',
    ]);
  });

  for (const script of SCRIPTS) {
    it(`${script}: parses (bash -n), sources names.env, fails fast, and mutates only under --apply`, () => {
      const syntax = spawnSync('bash', ['-n', join(OPS, script)], {
        encoding: 'utf8',
      });
      assert.equal(syntax.status, 0, syntax.stderr);
      const text = read(`tools/ops/${script}`);
      assert.match(text, /^#!\/usr\/bin\/env bash\n/);
      assert.match(text, /^set -euo pipefail$/m);
      assert.match(text, /^\. "\$HERE\/names\.env"$/m);
      // APPLY is set in exactly one place: the --apply argument.
      assert.deepEqual(
        [...text.matchAll(/APPLY=1/g)].length,
        1,
        'APPLY=1 appears once',
      );
      assert.match(text, /^ {4}--apply\) APPLY=1 ;;$/m);
    });

    if (GCLOUD_SCRIPTS.includes(script)) {
      it(`${script}: run with no arguments, prints its gcloud commands, runs none and exits 0`, () => {
        rmSync(marker, { force: true });
        const run = dryRun(script);
        assert.equal(run.status, 0, run.err);
        assert.match(run.out, /^\+ gcloud /m);
        assert.match(
          run.out,
          /^# dry run: nothing ran against your-project-id\./m,
        );
        assert.equal(existsSync(marker), false, 'the stub gcloud was called');
        // Named, still dry: the project shows, nothing runs.
        const named = dryRun(script, ['--project', 'creativo-v2-prod']);
        assert.equal(named.status, 0, named.err);
        assert.match(
          named.out,
          /--project=creativo-v2-prod|get-iam-policy creativo-v2-prod/,
        );
        assert.equal(existsSync(marker), false, 'the stub gcloud was called');
      });
    }

    if (GCLOUD_SCRIPTS.includes(script)) {
      it(`${script}: refuses the legacy projects with exit 2 — before printing or running anything, dry run included (ADR 2026-11-18, E11)`, () => {
        const text = read(`tools/ops/${script}`);
        assert.match(text, /^\. "\$HERE\/lib\/legacy-projects\.sh"$/m);
        assert.match(text, /^done\nrefuse_legacy_project "\$PROJECT"$/m);
        for (const id of ['creativo-prod', 'creativo-staging']) {
          for (const args of [
            ['--project', id],
            ['--project', id, '--apply'],
          ]) {
            rmSync(marker, { force: true });
            const run = dryRun(script, args);
            assert.equal(run.status, 2, `${script} ${args.join(' ')}`);
            assert.equal(run.out, '');
            assert.match(run.err, /^refused: .*old, live app/);
            assert.equal(existsSync(marker), false);
          }
        }
      });
    }

    it(`${script}: refuses an unknown argument with exit 2, running nothing`, () => {
      rmSync(marker, { force: true });
      const run = dryRun(script, ['--force']);
      assert.equal(run.status, 2);
      assert.match(run.err, /unknown argument: --force/);
      assert.equal(existsSync(marker), false);
    });
  }
});

describe('tools/ops/names.env — one source of names', () => {
  it('reads the same in the preflight as in bash, every value plain', () => {
    const names = opsNamesOf(read('tools/ops/names.env'));
    const keys = Object.keys(names).sort();
    const shell = spawnSync(
      'bash',
      [
        '-c',
        `set -eu; . tools/ops/names.env; for key in ${keys.join(' ')}; do printf '%s=%s\\n' "$key" "\${!key}"; done`,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(shell.status, 0, shell.stderr);
    assert.deepEqual(
      Object.fromEntries(
        shell.stdout
          .trim()
          .split('\n')
          .map((line) => [
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1),
          ]),
      ),
      names,
    );
    assert.deepEqual(
      {
        LOG_SINK_NAME: names.LOG_SINK_NAME,
        LOG_BUCKET_ID: names.LOG_BUCKET_ID,
        LOG_BUCKET_LOCATION: names.LOG_BUCKET_LOCATION,
        LOG_BUCKET_RETENTION_DAYS: names.LOG_BUCKET_RETENTION_DAYS,
        PITR_DAYS: names.PITR_DAYS,
        BACKUP_RETENTION: names.BACKUP_RETENTION,
        DATABASE_ID: names.DATABASE_ID,
      },
      {
        LOG_SINK_NAME: 'creativo-audit-sink',
        LOG_BUCKET_ID: 'creativo-audit-400d',
        LOG_BUCKET_LOCATION: 'global',
        LOG_BUCKET_RETENTION_DAYS: '400',
        PITR_DAYS: '7',
        BACKUP_RETENTION: '28d',
        DATABASE_ID: '(default)',
      },
    );
    assert.ok(Number(names.LOG_BUCKET_RETENTION_DAYS) >= 400);
  });
});

describe('tools/ops/log-sink.sh — the 400-day sink (RU-36)', () => {
  it('routes exactly RU-36’s filter into the bucket of names.env, creating or updating', () => {
    const { out } = dryRun('log-sink.sh');
    const destination =
      'logging.googleapis.com/projects/your-project-id/locations/global/buckets/creativo-audit-400d';
    for (const verb of ['create', 'update']) {
      assert.ok(
        out.includes(
          `+ gcloud logging sinks ${verb} creativo-audit-sink ${destination} '--log-filter=${SINK_FILTER}'`,
        ),
        `the sink ${verb} carries RU-36's filter`,
      );
    }
    assert.match(
      out,
      /^\+ gcloud logging buckets create creativo-audit-400d --location=global --retention-days=400 /m,
    );
    assert.ok(
      read('tools/ops/log-sink.sh').includes(`SINK_FILTER='${SINK_FILTER}'`),
    );
  });

  it('never locks the bucket unless --lock is passed — and no other script can', () => {
    const plain = dryRun('log-sink.sh');
    assert.doesNotMatch(plain.out, /--locked/);
    assert.match(plain.out, /^# not locked\./m);
    const locked = dryRun('log-sink.sh', ['--lock']);
    assert.equal(locked.status, 0, locked.err);
    assert.match(
      locked.out,
      /^\+ gcloud logging buckets update creativo-audit-400d --location=global --locked --project=your-project-id$/m,
    );
    assert.match(locked.out, /IRREVERSIBLE/);
    for (const script of SCRIPTS.filter((name) => name !== 'log-sink.sh')) {
      assert.doesNotMatch(read(`tools/ops/${script}`), /--lock/, script);
    }
    // The lock runs only inside the explicit --lock branch.
    assert.match(
      read('tools/ops/log-sink.sh'),
      /if \[ "\$LOCK" = 1 \]; then\n[^\n]*\n {2}run gcloud logging buckets update [^\n]* --locked /,
    );
  });
});

describe('tools/ops/audit-logs.sh — Data Access (RU-34)', () => {
  it('prints the volume and billing caveat first, then DATA_WRITE and ADMIN_READ for datastore.googleapis.com and identitytoolkit.googleapis.com — never DATA_READ', () => {
    const { out } = dryRun('audit-logs.sh');
    assert.ok(out.indexOf('VOLUME AND BILLING') < out.indexOf('+ gcloud'));
    const merged = JSON.parse(
      out
        .split('\n')
        .filter((line) => line.startsWith('#   '))
        .map((line) => line.slice(4))
        .join('\n'),
    );
    assert.deepEqual(merged, {
      auditConfigs: [
        {
          service: 'datastore.googleapis.com',
          auditLogConfigs: [
            { logType: 'DATA_WRITE' },
            { logType: 'ADMIN_READ' },
          ],
        },
        {
          service: 'identitytoolkit.googleapis.com',
          auditLogConfigs: [
            { logType: 'DATA_WRITE' },
            { logType: 'ADMIN_READ' },
          ],
        },
      ],
    });
    assert.doesNotMatch(
      read('tools/ops/audit-logs.sh'),
      /LOG_TYPES=\([^)]*DATA_READ/,
    );
    assert.match(read('tools/ops/audit-logs.sh'), /UNCONFIRMED/);
  });
});

describe('tools/ops/firestore-backups.sh — PITR and the daily schedule', () => {
  it('turns PITR on and creates a daily schedule kept 28 days, each behind its probe', () => {
    const { out } = dryRun('firestore-backups.sh');
    assert.match(
      out,
      /^\+ gcloud firestore databases describe '--database=\(default\)' --project=your-project-id '--format=value\(pointInTimeRecoveryEnablement\)'$/m,
    );
    assert.match(
      out,
      /^\+ gcloud firestore databases update '--database=\(default\)' --enable-pitr --project=your-project-id$/m,
    );
    assert.match(
      out,
      /^\+ gcloud firestore backups schedules list '--database=\(default\)' /m,
    );
    assert.match(
      out,
      /^\+ gcloud firestore backups schedules create '--database=\(default\)' --recurrence=daily --retention=28d --project=your-project-id$/m,
    );
  });
});

describe('tools/ops/log-metrics.sh — metrics and alerts keyed on LogEvent values', () => {
  it('names only LogEvent values in every message filter — the scripts, the alerts and the printed configs', () => {
    const values = logEventValues();
    const texts = [
      ...SCRIPTS.flatMap((script) => messageTexts(read(`tools/ops/${script}`))),
      ...ALERTS.flatMap((file) =>
        messageTexts(read(`tools/ops/alerts/${file}`)),
      ),
      ...messageTexts(dryRun('log-metrics.sh').out),
    ];
    assert.ok(texts.length >= 8, `found ${texts.length} message filters`);
    for (const text of texts) {
      assert.ok(values.has(text), `"${text}" is not a LogEvent value`);
    }
  });

  it('creates the eight metrics of names.env — each server metric on one LogEvent message, client_issue_count on the OR-34 recipe', () => {
    const names = opsNamesOf(read('tools/ops/names.env'));
    const values = logEventValues();
    const { out } = dryRun('log-metrics.sh');
    const configs = new Map();
    for (const block of out.split(/^# metric /m).slice(1)) {
      const name = block.slice(0, block.indexOf(' '));
      const filter = /^# {3}filter: '(.*)'$/m.exec(block)?.[1];
      configs.set(name, filter);
      assert.ok(
        block
          .split('\n')
          .includes(
            `+ gcloud logging metrics create ${name} --config-from-file=${name}.yaml --project=your-project-id`,
          ),
        `${name} is created from its config`,
      );
    }
    const metricNames = Object.entries(names)
      .filter(([key]) => key.startsWith('METRIC_'))
      .map(([, value]) => value)
      .sort();
    assert.deepEqual([...configs.keys()].sort(), metricNames);
    assert.equal(metricNames.length, 8);
    assert.equal(
      configs.get('client_issue_count'),
      'jsonPayload.clientIssueKind:*',
    );
    const expected = {
      trigger_attempt_failed: 'TriggerAttemptFailed',
      document_refused: 'DocumentRefused',
      audit_actor_missing: 'AuditActorMissing',
      callable_failed: 'CallableFailed',
      // Security hardening S-RU-10: one failed revoke alerts.
      roles_sessions_not_revoked: 'RolesSessionsNotRevoked',
      // Next pass (2026-11-03): one unrecorded dead letter alerts.
      trigger_failure_not_recorded: 'TriggerFailureNotRecorded',
      // The login-OTP sender (2026-11-17): a flood of billed codes alerts.
      otp_code_sent: 'OtpSent',
    };
    const source = read('libs/ecs-core/src/primitives/log-event.data.ts');
    for (const [metric, key] of Object.entries(expected)) {
      const value = [
        ...source.matchAll(/^\s+([A-Z][A-Za-z]*):\s*'([^']*)',/gm),
      ].find((match) => match[1] === key)?.[2];
      assert.ok(value && values.has(value), `LogEvent.${key}`);
      assert.equal(
        configs.get(metric),
        `resource.type="cloud_run_revision" AND NOT jsonPayload.clientIssueKind:* AND jsonPayload.message:"${value}"`,
        metric,
      );
    }
    // The labels the brief names.
    assert.match(out, /^# {5}outcome: EXTRACT\(jsonPayload\.outcome\)$/m);
    assert.match(out, /^# {5}fn: EXTRACT\(jsonPayload\.fn\)$/m);
    assert.match(out, /^# {5}callable: EXTRACT\(jsonPayload\.callable\)$/m);
    assert.match(out, /^# {5}kind: EXTRACT\(jsonPayload\.clientIssueKind\)$/m);
  });

  it('alerts on every metric it creates, and on nothing else', () => {
    const names = opsNamesOf(read('tools/ops/names.env'));
    const metrics = new Set(
      Object.entries(names)
        .filter(([key]) => key.startsWith('METRIC_'))
        .map(([, value]) => value),
    );
    const alerted = new Set();
    for (const file of ALERTS) {
      const text = read(`tools/ops/alerts/${file}`);
      assert.match(text, /^displayName: '[^']+'$/m, file);
      const used = [
        ...text.matchAll(/logging\.googleapis\.com\/user\/([a-z_]+)/g),
      ].map((match) => match[1]);
      assert.ok(used.length > 0, file);
      for (const metric of used) {
        assert.ok(metrics.has(metric), `${file} names ${metric}`);
        alerted.add(metric);
      }
    }
    assert.deepEqual([...alerted].sort(), [...metrics].sort());
    const { out } = dryRun('log-metrics.sh');
    for (const file of ALERTS) {
      assert.ok(
        out.includes(
          `+ gcloud alpha monitoring policies create --policy-from-file=alerts/${file} --project=your-project-id`,
        ),
        file,
      );
    }
  });

  it('the roles alert names the remedy that outlives the admin’s tab (security hardening S-RU-10, review round 1 finding 6)', () => {
    const text = read('tools/ops/alerts/roles-sessions-not-revoked.yaml');
    // The card's retry lives in the admin's tab, never longer.
    assert.match(text, /only while the admin's browser tab\s+stays open/);
    // The always-working remedy, keyed by the log line's target uid.
    assert.match(
      text,
      /getAuth\(\)\.revokeRefreshTokens\('<targetUserId from the log line>'\)/,
    );
  });
});

describe('tools/ops/github-repo-settings.sh — the release flow’s GitHub settings (ADR 2026-11-18)', () => {
  const SCRIPT = 'github-repo-settings.sh';
  const REPO = ['--repo', 'owner-x/repo-y'];

  /** The JSON a `#   {…}` body line of `out` shows, after `marker`. */
  const bodyAfter = (out, marker) => {
    const lines = out.split('\n');
    const at = lines.findIndex((line) => line.includes(marker));
    return lines
      .slice(at)
      .find((line) => line.startsWith('#   {'))
      .slice(4);
  };

  it('run with no arguments, prints its gh commands, runs none and exits 0', () => {
    rmSync(marker, { force: true });
    const run = dryRun(SCRIPT, REPO);
    assert.equal(run.status, 0, run.err);
    assert.match(run.out, /^\+ gh api /m);
    assert.match(run.out, /^# dry run: nothing ran against owner-x\/repo-y\./m);
    assert.equal(existsSync(marker), false, 'the stub gh was called');
  });

  it('merges by squash only, titled by the PR title and bodied by its description, and deletes merged branches', () => {
    const { out } = dryRun(SCRIPT, REPO);
    assert.ok(
      out.includes(
        '+ gh api --method PATCH repos/owner-x/repo-y -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY -F delete_branch_on_merge=true',
      ),
    );
  });

  it('updates the main ruleset in place — PUT to the one it found, never a new one', () => {
    const { out } = dryRun(SCRIPT, REPO);
    assert.match(
      out,
      /^\+ gh api repos\/owner-x\/repo-y\/rulesets --jq '\.\[\] \| select\(\.name == "main requires pull requests"\) \| \.id'$/m,
    );
    assert.match(
      out,
      /^\+ gh api --method PUT 'repos\/owner-x\/repo-y\/rulesets\/<main-ruleset-id>' --input \S+\/main-ruleset\.json$/m,
    );
    assert.doesNotMatch(
      read(`tools/ops/${SCRIPT}`),
      /--method POST "repos\/\$REPO\/rulesets" --input "\$TMP\/main-ruleset\.json"/,
    );
  });

  it('keeps every rule, check and bypass it reads, adds pr-title once and leaves squash the only merge method', (t) => {
    const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
    if (jq.status !== 0) {
      t.skip('no jq on PATH (gh runs its own; the runner image ships jq)');
      return;
    }
    const text = read(`tools/ops/${SCRIPT}`);
    const rules = /^CONVERGE_RULES='([\s\S]*?)'$/m
      .exec(text)[1]
      .replace(`'"$ACTIONS_INTEGRATION_ID"'`, '15368');
    const mainBody = /^MAIN_BODY='([^\n]*)'$/m
      .exec(text)[1]
      .replace(`'"$CONVERGE_RULES"'`, rules);
    const releaseBody = /^RELEASE_BODY='([^\n]*)'$/m
      .exec(text)[1]
      .replace(`'"$RELEASE_RULESET"'`, 'release branches require pull requests')
      .replace(`'"$CONVERGE_RULES"'`, rules);
    // The live ruleset's shape (2026-11-18), as `gh api …/rulesets/<id>` reads it.
    const live = {
      id: 26367400,
      name: 'main requires pull requests',
      target: 'branch',
      source_type: 'Repository',
      enforcement: 'active',
      conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
          },
        },
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [
              { context: 'main', integration_id: 15368 },
              { context: 'pr-title', integration_id: 15368 },
              { context: 'e2e', integration_id: 15368 },
            ],
          },
        },
      ],
      bypass_actors: [],
      _links: { self: { href: 'https://api.github.com/…' } },
    };
    const apply = (filter) => {
      const result = spawnSync('jq', ['-c', filter], {
        input: JSON.stringify(live),
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const main = apply(mainBody);
    assert.deepEqual(Object.keys(main).sort(), [
      'bypass_actors',
      'conditions',
      'enforcement',
      'name',
      'rules',
      'target',
    ]);
    assert.deepEqual(
      main.rules.map((rule) => rule.type),
      [
        'deletion',
        'non_fast_forward',
        'pull_request',
        'required_status_checks',
      ],
    );
    assert.deepEqual(main.rules[2].parameters, {
      required_approving_review_count: 0,
      allowed_merge_methods: ['squash'],
    });
    assert.deepEqual(main.rules[3].parameters, {
      strict_required_status_checks_policy: false,
      required_status_checks: [
        { context: 'main', integration_id: 15368 },
        { context: 'e2e', integration_id: 15368 },
        { context: 'pr-title', integration_id: 15368 },
      ],
    });
    assert.deepEqual(main.conditions, live.conditions);
    const release = apply(releaseBody);
    assert.equal(release.name, 'release branches require pull requests');
    assert.deepEqual(release.conditions, {
      ref_name: { include: ['refs/heads/release/**'], exclude: [] },
    });
    assert.deepEqual(release.rules, main.rules);
  });

  it('lets only the release App create, move or delete a v* tag', () => {
    const { out } = dryRun(SCRIPT, REPO);
    const body = bodyAfter(out, "# 4. 'release tags'");
    assert.equal(
      body,
      '{"name":"release tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":<release-app-id>,"actor_type":"Integration","bypass_mode":"always"}]}',
    );
  });

  it('makes staging deployable from main only, and production from v* tags only after the owner approves', () => {
    const { out } = dryRun(SCRIPT, REPO);
    assert.equal(
      bodyAfter(out, '# 5. the environments'),
      '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}',
    );
    assert.ok(
      out.includes(
        '+ gh api --method POST repos/owner-x/repo-y/environments/staging/deployment-branch-policies -f name=main -f type=branch',
      ),
    );
    assert.ok(out.includes('+ gh api users/owner-x --jq .id'));
    const production = JSON.parse(
      bodyAfter(out, '+ gh api users/owner-x --jq .id').replace(
        '<owner-user-id>',
        '1',
      ),
    );
    assert.deepEqual(production, {
      wait_timer: 0,
      prevent_self_review: false,
      can_admins_bypass: false,
      reviewers: [{ type: 'User', id: 1 }],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    });
    assert.ok(
      out.includes(
        "+ gh api --method POST repos/owner-x/repo-y/environments/production/deployment-branch-policies -f 'name=v*' -f type=tag",
      ),
    );
  });

  it('sets the App’s client ID as a variable and its key as a secret, never echoing the key', () => {
    const { out } = dryRun(SCRIPT, REPO);
    assert.ok(
      out.includes(
        "+ gh variable set RELEASE_APP_CLIENT_ID --repo owner-x/repo-y --body '<client-id>'",
      ),
    );
    assert.ok(
      out.includes(
        "+ gh secret set RELEASE_APP_PRIVATE_KEY --repo owner-x/repo-y '<' '<app.pem>'",
      ),
    );
    assert.doesNotMatch(read(`tools/ops/${SCRIPT}`), /cat "\$APP_KEY_FILE"/);
  });

  it('refuses --apply without a numeric App id, or with half the App’s credentials, running nothing', () => {
    rmSync(marker, { force: true });
    for (const args of [
      [...REPO, '--apply'],
      [...REPO, '--apply', '--release-app-id', 'my-app'],
      [
        ...REPO,
        '--apply',
        '--release-app-id',
        '7',
        '--release-app-client-id',
        'Iv1.x',
      ],
    ]) {
      const run = dryRun(SCRIPT, args);
      assert.equal(run.status, 2, args.join(' '));
    }
    assert.equal(existsSync(marker), false);
  });
});

describe('tools/ops/deploy-identity.sh — Workload Identity Federation per environment (ADR 2026-11-18, E8)', () => {
  const SCRIPT = 'deploy-identity.sh';
  const args = (environment) => [
    '--project',
    'creativo-v2-prod',
    '--environment',
    environment,
    '--repo',
    'owner-x/repo-y',
  ];

  it('federates this repository’s jobs of one environment — by repository id, and for production only from refs/tags/v*', () => {
    const production = dryRun(SCRIPT, args('production')).out;
    assert.ok(
      production.includes(
        "+ gcloud iam workload-identity-pools providers create-oidc creativo-deploy --location=global --workload-identity-pool=github-actions --issuer-uri=https://token.actions.githubusercontent.com '--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref,attribute.repository_environment=assertion.repository_id+'\\''/'\\''+assertion.environment' '--attribute-condition=assertion.repository_id == '\\''REPOSITORY_ID'\\'' && assertion.environment == '\\''production'\\'' && assertion.ref.startsWith('\\''refs/tags/v'\\'')' --project=creativo-v2-prod",
      ),
      production,
    );
    const staging = dryRun(SCRIPT, args('staging')).out;
    assert.match(
      staging,
      /assertion\.environment == '\\''staging'\\'' && assertion\.ref == '\\''refs\/heads\/main'\\''/,
    );
    assert.doesNotMatch(staging, /refs\/tags/);
  });

  it('lets only that environment’s jobs impersonate the deploy account — by repository id and environment, never by the token’s subject', () => {
    const { out } = dryRun(SCRIPT, args('production'));
    assert.ok(
      out.includes(
        '+ gcloud iam service-accounts add-iam-policy-binding creativo-deployer@creativo-v2-prod.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member=principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository_environment/REPOSITORY_ID/production --project=creativo-v2-prod',
      ),
      out,
    );
    // GitHub's immutable subjects (repo:<owner>@<id>/<name>@<id>:…) never
    // matched the classic repo:<owner/name>:environment:<env> binding: the
    // first staging deploy was refused iam.serviceAccounts.getAccessToken.
    assert.doesNotMatch(out, /principal:\/\/[^ ]*\/subject\//);
  });

  it('grants the deploy account exactly the roles firebase-tools deploys with — never owner, editor or an IAM admin', () => {
    const { out } = dryRun(SCRIPT, args('staging'));
    const roles = [
      ...out.matchAll(
        /^\+ gcloud projects add-iam-policy-binding creativo-v2-prod --member=serviceAccount:creativo-deployer@creativo-v2-prod\.iam\.gserviceaccount\.com --role=(\S+) --condition=None$/gm,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(roles, [
      'roles/firebasehosting.admin',
      'roles/firebaserules.admin',
      'roles/datastore.indexAdmin',
      'roles/datastore.viewer',
      'roles/cloudfunctions.admin',
      'roles/run.admin',
      'roles/cloudscheduler.admin',
      'roles/secretmanager.viewer',
      'roles/artifactregistry.reader',
      'roles/serviceusage.serviceUsageConsumer',
      'roles/serviceusage.serviceUsageViewer',
      'roles/logging.viewer',
    ]);
    assert.doesNotMatch(
      out,
      /roles\/(owner|editor|resourcemanager\.projectIamAdmin|iam\.securityAdmin|secretmanager\.admin|firebase\.admin)\b/,
    );
    // actAs on the runtime account alone, never on the project.
    assert.ok(
      out.includes(
        '+ gcloud iam service-accounts add-iam-policy-binding PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/iam.serviceAccountUser --member=serviceAccount:creativo-deployer@creativo-v2-prod.iam.gserviceaccount.com --project=creativo-v2-prod',
      ),
    );
    assert.doesNotMatch(
      out,
      /add-iam-policy-binding creativo-v2-prod [^\n]*serviceAccountUser/,
    );
  });

  it('makes sure the runtime account exists, then lets it sign its own custom tokens — on itself, never project-wide', () => {
    const { out } = dryRun(SCRIPT, args('staging'));
    const runtime = 'PROJECT_NUMBER-compute@developer.gserviceaccount.com';
    // Compute Engine's API is what creates the default compute account.
    assert.match(
      out,
      /^\+ gcloud services enable [^\n]* compute\.googleapis\.com /m,
    );
    assert.match(
      out,
      /^\+ gcloud services enable [^\n]* iamcredentials\.googleapis\.com /m,
    );
    const describe = out.indexOf(
      `+ gcloud iam service-accounts describe ${runtime} --project=creativo-v2-prod`,
    );
    const tokenCreator = out.indexOf(
      `+ gcloud iam service-accounts add-iam-policy-binding ${runtime} --role=roles/iam.serviceAccountTokenCreator --member=serviceAccount:${runtime} --project=creativo-v2-prod`,
    );
    assert.ok(
      describe >= 0,
      'the runtime account is described before it is bound',
    );
    assert.ok(
      tokenCreator > describe,
      'Token Creator on itself, after the wait',
    );
    assert.doesNotMatch(
      out,
      /add-iam-policy-binding creativo-v2-prod --member=serviceAccount:PROJECT_NUMBER-compute@[^\n]*serviceAccountTokenCreator/,
    );
  });

  it('creates the Pub/Sub service agent before binding it — a new project has none until asked', () => {
    const { out } = dryRun(SCRIPT, args('staging'));
    const identity = out.indexOf(
      '+ gcloud beta services identity create --service=pubsub.googleapis.com --project=creativo-v2-prod',
    );
    const binding = out.indexOf(
      '--member=serviceAccount:service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator',
    );
    assert.ok(identity >= 0, 'the agent is created');
    assert.ok(binding > identity, 'and only then bound');
  });

  it('grants up front what a first deploy would grant itself — the agents, the runtime account’s secrets', () => {
    const { out } = dryRun(SCRIPT, args('staging'));
    for (const line of [
      '--member=serviceAccount:service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator',
      '--member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/run.invoker',
      '--member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/eventarc.eventReceiver',
      '--member=serviceAccount:service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com --role=roles/firebaserules.firestoreServiceAgent',
    ]) {
      assert.ok(out.includes(line), line);
    }
    for (const secret of [
      'WALKIN_ID_KEY',
      'LOG_DIGEST_KEY',
      'OTP_POSTMARK_TOKEN',
      'OTP_EMAIL_FROM',
    ]) {
      assert.ok(
        out.includes(
          `+ gcloud secrets add-iam-policy-binding ${secret} --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=creativo-v2-prod`,
        ),
        secret,
      );
    }
  });

  it('sets the environment’s three variables — no secret, no key', () => {
    const { out } = dryRun(SCRIPT, args('production'));
    assert.deepEqual(
      [
        ...out.matchAll(
          /^\+ gh variable set (\S+) --env production --repo owner-x\/repo-y --body (\S+)$/gm,
        ),
      ].map((match) => [match[1], match[2]]),
      [
        ['FIREBASE_PROJECT_ID', 'creativo-v2-prod'],
        [
          'GCP_WORKLOAD_IDENTITY_PROVIDER',
          'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/creativo-deploy',
        ],
        [
          'GCP_DEPLOY_SERVICE_ACCOUNT',
          'creativo-deployer@creativo-v2-prod.iam.gserviceaccount.com',
        ],
      ],
    );
    const text = read(`tools/ops/${SCRIPT}`);
    assert.doesNotMatch(text, /keys create|gh secret set|credentials_json/);
  });

  it('refuses --apply without an environment, and an environment of no name, running nothing', () => {
    rmSync(marker, { force: true });
    for (const bad of [
      ['--project', 'creativo-v2-prod', '--apply', '--repo', 'owner-x/repo-y'],
      ['--project', 'creativo-v2-prod', '--environment', 'prod'],
    ]) {
      assert.equal(dryRun(SCRIPT, bad).status, 2, bad.join(' '));
    }
    assert.equal(existsSync(marker), false);
  });
});
