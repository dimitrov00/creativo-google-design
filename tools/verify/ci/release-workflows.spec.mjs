// node --test tools/verify/ci/release-workflows.spec.mjs
//
// The release workflows (ADR docs/architecture/decisions/2026-11-18-releases-and-environments.md),
// held to their contract at the text level, as the CI workflow's spec holds
// ci.yml: the PR-title check runs on every title edit, under the ruleset's
// job name, with the title never inside a script; release-please runs only
// on pushes to main and release branches, with a GitHub App's token (never
// GITHUB_TOKEN), every action pinned to a full commit sha, and nothing but
// `contents: read` granted to the workflow's own token.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  headOf,
  isPinned,
  isShaPinned,
  jobsOf,
  occurrences,
  secretsOf,
  usesOf,
  withoutComments,
} from './workflow-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const LOCAL_ACTION = './.github/actions/setup-workspace';

/** What no release workflow may hold. */
const FORBIDDEN = [
  'pull_request_target',
  'continue-on-error',
  '|| true',
  'secrets: inherit',
  'write-all',
  'firebase deploy',
  'gcloud',
];

describe('.github/workflows/pr-title.yml — the title is the commit', () => {
  const TEXT = read('.github/workflows/pr-title.yml');
  const CODE = withoutComments(TEXT);
  const JOBS = jobsOf(TEXT);

  it('runs on every PR event that changes the title or the head, never pull_request_target', () => {
    assert.match(
      CODE,
      /^on:\n {2}pull_request:\n {4}types: \[opened, edited, synchronize, reopened\]\s*$/m,
    );
    for (const needle of FORBIDDEN) {
      assert.equal(occurrences(CODE, needle), 0, needle);
    }
  });

  it('is ONE job named pr-title — the main ruleset’s required check', () => {
    assert.deepEqual([...JOBS.keys()], ['pr-title']);
    assert.match(JOBS.get('pr-title'), /^ {4}timeout-minutes: \d+\s*$/m);
  });

  it('grants only contents: read and names no secret', () => {
    assert.match(headOf(TEXT), /^permissions:\n {2}contents: read\s*$/m);
    assert.doesNotMatch(CODE, /:\s*write\s*$/m);
    assert.deepEqual(secretsOf(TEXT), []);
  });

  it('lints the title with the repository’s commitlint, the title passed as data', () => {
    const job = JOBS.get('pr-title');
    assert.deepEqual(usesOf(job), ['actions/checkout@v5', LOCAL_ACTION]);
    assert.ok(
      usesOf(job).every((ref) => ref === LOCAL_ACTION || isPinned(ref)),
    );
    assert.match(
      job,
      /- run: printf '%s\\n' "\$PR_TITLE" \| pnpm exec commitlint --verbose\n {8}env:\n {10}PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}\s*$/m,
    );
    // The title appears once: in the env mapping, never in a script.
    assert.equal(occurrences(CODE, 'github.event.pull_request.title'), 1);
  });
});

describe('.github/workflows/release.yml — release-please under the App’s token', () => {
  const TEXT = read('.github/workflows/release.yml');
  const CODE = withoutComments(TEXT);
  const JOBS = jobsOf(TEXT);

  it('runs on pushes to main and to release branches only', () => {
    assert.match(
      CODE,
      /^on:\n {2}push:\n {4}branches:\n {6}- main\n {6}- 'release\/\*\*'\s*$/m,
    );
    for (const needle of FORBIDDEN) {
      assert.equal(occurrences(CODE, needle), 0, needle);
    }
  });

  it('never cancels a run, one per branch', () => {
    assert.match(
      CODE,
      /^concurrency:\n {2}group: release-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false\s*$/m,
    );
  });

  it('grants its own token only contents: read', () => {
    assert.match(headOf(TEXT), /^permissions:\n {2}contents: read\s*$/m);
    assert.doesNotMatch(CODE, /^\s*permissions:\s*write/m);
  });

  it('is skipped, not failed, until the owner has made the App', () => {
    assert.deepEqual([...JOBS.keys()], ['release-please']);
    const job = JOBS.get('release-please');
    assert.match(
      job,
      /^ {4}if: \$\{\{ vars\.RELEASE_APP_CLIENT_ID != '' \}\}\s*$/m,
    );
    assert.match(job, /^ {4}timeout-minutes: \d+\s*$/m);
  });

  it('mints the App’s token with only what release-please writes, and hands release-please that token — never GITHUB_TOKEN', () => {
    const job = JOBS.get('release-please');
    assert.deepEqual(secretsOf(TEXT), ['RELEASE_APP_PRIVATE_KEY']);
    assert.match(job, /client-id: \$\{\{ vars\.RELEASE_APP_CLIENT_ID \}\}/);
    const permissions = [
      ...job.matchAll(/^\s+(permission-[a-z-]+): (\w+)\s*$/gm),
    ]
      .map((match) => `${match[1]}=${match[2]}`)
      .sort();
    assert.deepEqual(permissions, [
      'permission-contents=write',
      'permission-issues=write',
      'permission-pull-requests=write',
    ]);
    assert.match(job, /token: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
    assert.doesNotMatch(CODE, /GITHUB_TOKEN|github\.token/);
  });

  it('reads the committed config and manifest, on the branch it ran for', () => {
    const job = JOBS.get('release-please');
    assert.match(job, /config-file: release-please-config\.json/);
    assert.match(job, /manifest-file: \.release-please-manifest\.json/);
    assert.match(job, /target-branch: \$\{\{ github\.ref_name \}\}/);
  });

  it('pins every action it runs with a credential to a full commit sha', () => {
    const uses = usesOf(TEXT);
    assert.deepEqual(
      uses.map((ref) => ref.slice(0, ref.indexOf('@'))),
      ['actions/create-github-app-token', 'googleapis/release-please-action'],
    );
    for (const ref of uses) assert.ok(isShaPinned(ref), `${ref} is sha-pinned`);
    // The version each sha stands for is written beside it.
    for (const line of TEXT.split('\n').filter((l) =>
      /uses: \S+@[0-9a-f]{40}/.test(l),
    )) {
      assert.match(line, / # v\d+\.\d+\.\d+$/, line);
    }
  });
});
