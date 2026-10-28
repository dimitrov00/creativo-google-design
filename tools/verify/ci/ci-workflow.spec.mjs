// node --test tools/verify/ci/ci-workflow.spec.mjs
//
// The CI workflow (audit hardening Phase 3, WS-E — P3-DEP-24), held to its
// contract at the text level: the file is read as lines, never through a
// YAML package (no new dependency). What it pins: every job is bounded in
// time, every action is pinned, nothing is granted `write` and no secret but
// GITHUB_TOKEN is named; the emulator jobs carry JDK 21 and the jar cache;
// every command of the full gate (HANDOFF §4) runs exactly once, in the job
// the plan gives it; and no step updates or ignores a snapshot, deploys,
// reaches gcloud, runs the production preflight or swallows a failure.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const LOCAL_ACTION = './.github/actions/setup-workspace';
const LOCAL_ACTION_PATH = '.github/actions/setup-workspace/action.yml';

/** The text without its comments: a whole-line `#`, or ` #` to the end of a line. */
function withoutComments(text) {
  return text
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line.replace(/\s+#.*$/, '')))
    .join('\n');
}

/** How many times `needle` occurs in `text`. */
const occurrences = (text, needle) => text.split(needle).length - 1;

/** `jobs:` → { name: body } in file order, comments removed. */
function jobsOf(text) {
  const lines = withoutComments(text).split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.ok(start >= 0, 'the workflow declares `jobs:`');
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
    } else if (current !== null) {
      jobs.get(current).push(line);
    }
  }
  return new Map([...jobs].map(([name, body]) => [name, body.join('\n')]));
}

/** The value of every `key:` line of `text` (a step's `- key:` included), trimmed. */
function valuesOf(text, key) {
  const values = [];
  for (const line of withoutComments(text).split('\n')) {
    const entry = line.trim();
    const body = entry.startsWith('- ') ? entry.slice(2).trim() : entry;
    if (body.startsWith(`${key}:`))
      values.push(body.slice(key.length + 1).trim());
  }
  return values;
}

/** Every `uses:` value of `text`. */
const usesOf = (text) => valuesOf(text, 'uses');

/** Every `run:` command of `text` (one line each in this workflow). */
const runsOf = (text) => valuesOf(text, 'run');

/** `owner/repo[/path]@v<N>` or `…@<40-hex sha>`. */
function isPinned(ref) {
  const at = ref.lastIndexOf('@');
  if (at < 0) return false;
  const segments = ref.slice(0, at).split('/');
  const version = ref.slice(at + 1);
  return (
    segments.length >= 2 &&
    segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment)) &&
    (/^v\d+$/.test(version) || /^[0-9a-f]{40}$/.test(version))
  );
}

const WORKFLOW = read(WORKFLOW_PATH);
const CODE = withoutComments(WORKFLOW);
const JOBS = jobsOf(WORKFLOW);
const ACTION = read(LOCAL_ACTION_PATH);
const ACTION_CODE = withoutComments(ACTION);

/** The job of `name`, asserted present. */
function job(name) {
  assert.ok(JOBS.has(name), `the workflow has a \`${name}\` job`);
  return JOBS.get(name);
}

/** The jobs the plan's CI shape names (P3-L-15); `main` keeps its name. */
const JOB_NAMES = [
  'main',
  'static',
  'runbook-gates',
  'coverage',
  'emulators',
  'e2e',
  'csp-smoke',
];

/** The full gate's commands this workflow runs, and the job each runs in. */
const GATE = [
  ['nx sync:check', 'static'],
  ['verify-tools:layering', 'static'],
  ['typecheck seed-tools', 'static'],
  ['test lint-rules', 'static'],
  ['lint:styles', 'static'],
  ['verify:bundle', 'static'],
  ['check-functions-deps.mjs', 'static'],
  ['--coverage', 'coverage'],
  ['verify-tools:runbook-gates', 'runbook-gates'],
  ['test:emulator', 'emulators'],
  ['verify:p0', 'emulators'],
  ['e2e:web', 'e2e'],
  ['verify:csp', 'csp-smoke'],
];

/** The jobs that start the emulators: JDK 21 and the jar cache. */
const EMULATOR_JOBS = ['emulators', 'e2e', 'csp-smoke'];
/** The jobs that drive a browser. */
const BROWSER_JOBS = [
  ['e2e', 'pnpm run e2e:web'],
  ['csp-smoke', 'pnpm run verify:csp'],
];

/** Text no step may hold (the skips, the deploys, the swallowed failures). */
const FORBIDDEN = [
  '--update-snapshots',
  '--ignore-snapshots',
  'updateSnapshots',
  'ignoreSnapshots',
  'firebase deploy',
  'gcloud',
  'preflight',
  'continue-on-error',
  '|| true',
  'pull_request_target',
  'workflow_run',
];

describe('the CI workflow', () => {
  it('runs on pushes to main and on pull requests, the stale PR run cancelled, never main', () => {
    assert.match(
      CODE,
      /^on:\n {2}push:\n {4}branches:\n {6}- main\n {2}pull_request:\s*$/m,
    );
    assert.match(
      CODE,
      /^concurrency:\n {2}group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    );
  });

  it('has exactly the plan’s jobs, `main` among them', () => {
    assert.deepEqual([...JOBS.keys()].sort(), [...JOB_NAMES].sort());
  });

  it('bounds every job in time', () => {
    for (const [name, body] of JOBS) {
      const timeout = /^ {4}timeout-minutes: (\d+)\s*$/m.exec(body);
      assert.ok(timeout, `${name} has a timeout-minutes`);
      assert.ok(Number(timeout[1]) > 0, `${name}'s timeout is positive`);
    }
  });

  it('pins every action to a major tag or a full sha; the one local action exists', () => {
    const uses = [...usesOf(WORKFLOW), ...usesOf(ACTION)];
    assert.ok(uses.length > 0, 'the workflow uses actions');
    for (const ref of uses) {
      if (ref === LOCAL_ACTION) continue;
      assert.ok(isPinned(ref), `${ref} is pinned`);
    }
    assert.ok(existsSync(join(ROOT, LOCAL_ACTION_PATH)), LOCAL_ACTION_PATH);
    assert.ok(
      uses.every((ref) => !ref.startsWith('./') || ref === LOCAL_ACTION),
      'no other local action',
    );
  });

  it('grants nothing but read', () => {
    assert.match(
      CODE.slice(0, CODE.indexOf('\njobs:')),
      /^permissions:\n {2}contents: read\s*$/m,
      'the workflow default is contents: read',
    );
    for (const text of [CODE, ACTION_CODE]) {
      assert.doesNotMatch(text, /:\s*write\s*$/m);
      assert.doesNotMatch(text, /write-all/);
    }
  });

  it('names no secret but GITHUB_TOKEN', () => {
    const named = [...CODE.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(named.length > 0, 'gitleaks still reads GITHUB_TOKEN');
    assert.deepEqual([...new Set(named)], ['GITHUB_TOKEN']);
    assert.doesNotMatch(CODE, /secrets:\s*inherit/);
    assert.doesNotMatch(ACTION_CODE, /secrets\./);
  });

  it('gives every emulator job JDK 21 and the emulator jar cache', () => {
    for (const name of EMULATOR_JOBS) {
      const body = job(name);
      assert.match(body, /uses: actions\/setup-java@v\d+\s*$/m, name);
      assert.match(body, /^\s+java-version: '21'\s*$/m, name);
      assert.match(
        body,
        /^\s+path: ~\/\.cache\/firebase\/emulators\s*$/m,
        name,
      );
    }
  });

  it('installs the Playwright chromium with its system dependencies before a browser runs', () => {
    for (const [name, command] of BROWSER_JOBS) {
      const runs = runsOf(job(name));
      const install = runs.indexOf(
        'pnpm exec playwright install --with-deps chromium',
      );
      assert.ok(install >= 0, `${name} installs the browser`);
      assert.ok(runs.indexOf(command) > install, `${name} installs it first`);
    }
  });

  it('runs every command of the full gate exactly once, in its job', () => {
    for (const [command, home] of GATE) {
      assert.equal(occurrences(CODE, command), 1, `${command} runs once`);
      assert.equal(
        occurrences(job(home), command),
        1,
        `${command} runs in ${home}`,
      );
    }
    const emulators = runsOf(job('emulators'));
    assert.ok(
      emulators.indexOf('pnpm run verify:p0') >
        emulators.indexOf('pnpm run test:emulator'),
      'the two emulator journeys run one after the other (they share ports)',
    );
  });

  it('keeps main’s affected run, with typecheck, and the static CSP gate', () => {
    const main = runsOf(job('main'));
    assert.ok(
      main.includes(
        'pnpm exec nx affected -t lint test build typecheck --base=$NX_BASE --head=$NX_HEAD',
      ),
      'affected lint test build typecheck (P3-RU-32)',
    );
    assert.ok(main.includes('node tools/verify/csp/check-csp.mjs'));
    assert.match(job('main'), /uses: nrwl\/nx-set-shas@v\d+\s*$/m);
    assert.match(job('main'), /uses: gitleaks\/gitleaks-action@v\d+\s*$/m);
  });

  it('sets up every other job through the shared action, after its checkout', () => {
    for (const name of JOB_NAMES.filter((jobName) => jobName !== 'main')) {
      const uses = usesOf(job(name));
      assert.match(
        uses[0],
        /^actions\/checkout@v\d+$/,
        `${name} checks out first`,
      );
      assert.equal(uses[1], LOCAL_ACTION, `${name} sets up second`);
    }
    assert.match(ACTION_CODE, /^\s+using: composite\s*$/m);
    assert.match(ACTION_CODE, /node-version-file: '\.nvmrc'/);
    assert.deepEqual(runsOf(ACTION), ['pnpm install --frozen-lockfile']);
    assert.equal(
      occurrences(ACTION_CODE, 'shell: bash'),
      runsOf(ACTION).length,
      'a composite run step names its shell',
    );
  });

  it('installs only from the frozen lockfile and restores no Nx cache', () => {
    for (const command of [...runsOf(WORKFLOW), ...runsOf(ACTION)]) {
      if (/\bpnpm (install|i|add)\b/.test(command)) {
        assert.equal(command, 'pnpm install --frozen-lockfile');
      }
    }
    const cached = [...CODE.matchAll(/^\s+path: (\S+)\s*$/gm)]
      .map((match) => match[1])
      .filter((path) => path.startsWith('~'));
    assert.deepEqual([...new Set(cached)].sort(), [
      '~/.cache/firebase/emulators',
      '~/.cache/ms-playwright',
    ]);
    assert.doesNotMatch(CODE, /\.nx\b/);
  });

  it('holds no step that updates or ignores a snapshot, deploys, reaches gcloud, runs the preflight or swallows a failure', () => {
    for (const text of [CODE, ACTION_CODE]) {
      for (const needle of FORBIDDEN) {
        assert.equal(occurrences(text, needle), 0, needle);
      }
      for (const command of runsOf(text)) {
        assert.doesNotMatch(command, /(^|\s)-u(\s|$)/, command);
      }
    }
  });

  it('sets the screenshot switch in the e2e job only, to skip', () => {
    assert.equal(occurrences(WORKFLOW, 'CREATIVO_E2E_SCREENSHOTS'), 1);
    assert.match(job('e2e'), /^\s+CREATIVO_E2E_SCREENSHOTS: skip\s*$/m);
  });
});
