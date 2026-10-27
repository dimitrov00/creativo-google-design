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

/** One dry run of `script`: a clean environment, the stub gcloud first on PATH. */
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
  const stub = join(stubDir, 'gcloud');
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> '${marker}'\nexit 97\n`);
  chmodSync(stub, 0o755);
});

after(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe('tools/ops — every script, dry by default', () => {
  it('holds the four scripts and the five alert policies the plan names', () => {
    assert.deepEqual(SCRIPTS, [
      'audit-logs.sh',
      'firestore-backups.sh',
      'log-metrics.sh',
      'log-sink.sh',
    ]);
    assert.deepEqual(ALERTS, [
      'audit-actor-missing.yaml',
      'callable-failures.yaml',
      'client-issues.yaml',
      'documents-refused.yaml',
      'trigger-attempts.yaml',
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
      const named = dryRun(script, ['--project', 'creativo-prod']);
      assert.equal(named.status, 0, named.err);
      assert.match(
        named.out,
        /--project=creativo-prod|get-iam-policy creativo-prod/,
      );
      assert.equal(existsSync(marker), false, 'the stub gcloud was called');
    });

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

  it('creates the five metrics of names.env — each server metric on one LogEvent message, client_issue_count on the OR-34 recipe', () => {
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
    assert.equal(
      configs.get('client_issue_count'),
      'jsonPayload.clientIssueKind:*',
    );
    const expected = {
      trigger_attempt_failed: 'TriggerAttemptFailed',
      document_refused: 'DocumentRefused',
      audit_actor_missing: 'AuditActorMissing',
      callable_failed: 'CallableFailed',
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
});
