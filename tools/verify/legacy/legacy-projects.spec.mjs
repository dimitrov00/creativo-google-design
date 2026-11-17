// node --test tools/verify/legacy/legacy-projects.spec.mjs
//
// The owner's OLD, live React app runs in the Firebase projects
// `creativo-prod` and `creativo-staging` (ADR 2026-11-18, E11). This
// product refuses them in three independent places that must agree — the
// JavaScript list (tools/release/legacy-projects.mjs: the preflight, the
// checkout pointer), the bash list (tools/ops/lib/legacy-projects.sh: every
// project-scoped ops script) and each deploy workflow's first step — and
// names them in no config, workflow or environment file anywhere else.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_PROJECT_IDS,
  isLegacyProject,
  legacyIdsIn,
} from '../../release/legacy-projects.mjs';
import { jobsOf } from '../ci/workflow-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The deploy workflows and the step in each that refuses the legacy projects. */
const DEPLOY_WORKFLOWS = [
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-production.yml',
];
const REFUSING_STEP = '- name: Refuse the legacy projects';

/** The homes of the list, where naming the ids is the point. */
const HOMES = [
  'tools/release/legacy-projects.mjs',
  'tools/ops/lib/legacy-projects.sh',
];

/**
 * The files that configure a build, a deploy or an environment: every
 * tracked JSON, YAML, env and rc file, the web's environment files, the
 * workflows and actions, the ops scripts and their names.
 */
const CONFIG =
  /(\.(json|jsonc|ya?ml|env|toml)|\.firebaserc|\.npmrc|\.nvmrc)$|^apps\/web\/src\/environments\/|^\.github\/|^tools\/ops\/|^tools\/flags\/[^/]+\.mjs$|^firestore\.rules$|^storage\.rules$/;

/** Every tracked config file, the lockfile aside (package names only). */
function configFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '' && path !== 'pnpm-lock.yaml')
    .filter((path) => CONFIG.test(path));
}

/** The `run:` block of the refusing step of a workflow's `deploy` job. */
function refusingStep(path) {
  const job = jobsOf(read(path)).get('deploy');
  assert.ok(job, `${path} has a deploy job`);
  const lines = job.split('\n');
  const start = lines.findIndex((line) => line.trim() === REFUSING_STEP);
  assert.ok(start >= 0, `${path} has a «Refuse the legacy projects» step`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {6}- /.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

describe('the legacy projects (ADR 2026-11-18, E11)', () => {
  it('are exactly creativo-prod and creativo-staging', () => {
    assert.deepEqual(
      [...LEGACY_PROJECT_IDS],
      ['creativo-prod', 'creativo-staging'],
    );
    assert.ok(isLegacyProject('creativo-prod'));
    assert.ok(!isLegacyProject('creativo-v2-prod'));
  });

  it('match only as a whole project id', () => {
    assert.deepEqual(legacyIdsIn('--project creativo-prod'), ['creativo-prod']);
    assert.deepEqual(legacyIdsIn('"creativo-staging"'), ['creativo-staging']);
    for (const other of [
      'creativo-v2-prod',
      'creativo-production',
      'creativo-staging-2',
      'xcreativo-prod',
    ]) {
      assert.deepEqual(legacyIdsIn(other), [], other);
    }
  });

  it('are the same list in bash as in JavaScript', () => {
    const bash = /^LEGACY_PROJECT_IDS=\(([^)]*)\)$/m.exec(
      read('tools/ops/lib/legacy-projects.sh'),
    );
    assert.ok(bash, 'the bash list is one array line');
    assert.deepEqual(bash[1].trim().split(/\s+/), [...LEGACY_PROJECT_IDS]);
  });

  it('are refused by every deploy workflow’s first step, before any repository code runs', () => {
    for (const path of DEPLOY_WORKFLOWS) {
      const job = jobsOf(read(path)).get('deploy');
      const firstStep = job
        .split('\n')
        .find((line) => /^ {6}- /.test(line))
        .trim();
      assert.equal(firstStep, REFUSING_STEP, `${path}: the first step`);
      const step = refusingStep(path);
      assert.match(
        step,
        new RegExp(
          `^ {12}${LEGACY_PROJECT_IDS.join(' \\| ')}\\) echo "::error::.*"; exit 1 ;;$`,
          'm',
        ),
        path,
      );
      assert.match(
        step,
        /^ {12}''\) echo "::error::.*no FIREBASE_PROJECT_ID.*"; exit 1 ;;$/m,
        path,
      );
    }
  });

  it('are named in no config, workflow or environment file but where they are refused', () => {
    const files = configFiles();
    assert.ok(files.includes('.firebaserc'));
    assert.ok(files.includes('firebase.json'));
    assert.ok(
      files.includes('apps/web/src/environments/environment.staging.ts'),
    );
    assert.ok(files.includes('.github/workflows/ci.yml'));
    const offenders = [];
    for (const path of files) {
      if (HOMES.includes(path)) continue;
      let text = read(path);
      if (DEPLOY_WORKFLOWS.includes(path)) {
        text = text.replace(refusingStep(path), '');
      }
      const named = legacyIdsIn(text);
      if (named.length > 0) offenders.push(`${path}: ${named.join(', ')}`);
    }
    assert.deepEqual(offenders, []);
  });
});
