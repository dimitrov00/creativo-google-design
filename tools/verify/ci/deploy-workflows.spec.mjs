// node --test tools/verify/ci/deploy-workflows.spec.mjs
//
// The deploy workflows and their shared action (ADR
// docs/architecture/decisions/2026-11-18-releases-and-environments.md,
// E4–E11), held to their contract at the text level: staging deploys only
// a commit CI passed on a push; production only a release tag, under the
// production environment; both refuse the legacy projects first; the
// action deploys in the runbook's order, non-interactively, with --force on
// the functions deploy alone (E6, amended 2026-11-19: main.spec.ts pins what
// it confirms) and never the preflight's escape hatch, through Workload
// Identity Federation pinned to a full sha, and names no secret at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  headOf,
  isShaPinned,
  jobsOf,
  occurrences,
  secretsOf,
  usesOf,
  withoutComments,
} from './workflow-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const STAGING = read('.github/workflows/deploy-staging.yml');
const PRODUCTION = read('.github/workflows/deploy-production.yml');
const ACTION = read('.github/actions/deploy/action.yml');
const SETUP = './.github/actions/setup-workspace';
const DEPLOY = './.github/actions/deploy';

/** What no deploy file may hold. */
const FORBIDDEN = [
  'pull_request_target',
  'pull_request',
  'continue-on-error',
  '|| true',
  'secrets: inherit',
  'write-all',
  'CREATIVO_SKIP_PREFLIGHT',
  'credentials_json',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

/** The `run:` lines and blocks of `text` with their bodies, comments removed. */
function runBodies(text) {
  const lines = withoutComments(text).split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(?:- )?run: (.*)$/.exec(lines[i]);
    if (!match) continue;
    if (match[2] !== '|') {
      bodies.push(match[2]);
      continue;
    }
    const indent = match[1].length;
    const block = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && lines[j].search(/\S/) <= indent) break;
      block.push(lines[j]);
    }
    bodies.push(block.join('\n'));
  }
  return bodies;
}

/** The action's step names, in order. */
const stepNames = (text) =>
  [
    ...withoutComments(text).matchAll(/^ {4}- (?:name: (.+)|uses: (\S+))$/gm),
  ].map((match) => match[1] ?? match[2]);

describe('every deploy file', () => {
  for (const [path, text] of [
    ['deploy-staging.yml', STAGING],
    ['deploy-production.yml', PRODUCTION],
    ['actions/deploy/action.yml', ACTION],
  ]) {
    it(`${path}: holds no forbidden text and names no secret`, () => {
      const code = withoutComments(text);
      for (const needle of FORBIDDEN) {
        assert.equal(occurrences(code, needle), 0, `${path}: ${needle}`);
      }
      assert.deepEqual(secretsOf(text), [], path);
    });

    it(`${path}: pins every external action to a full commit sha, its version beside it`, () => {
      for (const ref of usesOf(text)) {
        if (ref === SETUP || ref === DEPLOY) continue;
        assert.ok(isShaPinned(ref), `${path}: ${ref}`);
      }
      for (const line of text
        .split('\n')
        .filter((l) => /uses: \S+@[0-9a-f]{40}/.test(l))) {
        assert.match(line, / # v\d+\.\d+\.\d+$/, line);
      }
    });

    it(`${path}: never interpolates an expression into a script — every value arrives as an environment variable`, () => {
      for (const body of runBodies(text)) {
        assert.doesNotMatch(body, /\$\{\{/, `${path}: ${body}`);
      }
    });
  }
});

describe('deploy-staging.yml — staging is main', () => {
  const CODE = withoutComments(STAGING);
  const JOB = jobsOf(STAGING).get('deploy');

  it('runs only after CI completes on main or a release branch, and deploys only a success on a push', () => {
    assert.match(
      CODE,
      /^on:\n {2}workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]\n {4}branches:\n {6}- main\n {6}- 'release\/\*\*'\s*$/m,
    );
    assert.match(
      JOB,
      /^ {4}if: \$\{\{ github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.event == 'push' \}\}$/m,
    );
    assert.doesNotMatch(CODE, /workflow_dispatch/);
  });

  it('deploys one at a time, never cancelled, in the staging environment', () => {
    assert.match(
      CODE,
      /^concurrency:\n {2}group: deploy-staging\n {2}cancel-in-progress: false\s*$/m,
    );
    assert.match(JOB, /^ {4}environment:\n {6}name: staging\n/m);
  });

  it('grants the workflow only contents: read, and the job an OIDC token besides', () => {
    assert.match(headOf(STAGING), /^permissions:\n {2}contents: read\s*$/m);
    assert.match(
      JOB,
      /^ {4}permissions:\n {6}contents: read\n {6}id-token: write\n {4}env:/m,
    );
  });

  it('checks out the very commit CI passed, keeping no credential in the checkout', () => {
    assert.match(
      JOB,
      /- uses: actions\/checkout@[0-9a-f]{40}\n {8}with:\n {10}ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n {10}persist-credentials: false/,
    );
  });

  it('deploys through the shared action as staging, named by the branch the commit is on', () => {
    assert.deepEqual(usesOf(JOB).slice(1), [SETUP, DEPLOY]);
    assert.match(JOB, /^ {10}environment: staging$/m);
    assert.match(JOB, /^ {10}project: \$\{\{ vars\.FIREBASE_PROJECT_ID \}\}$/m);
    assert.match(
      JOB,
      /^ {10}ref: refs\/heads\/\$\{\{ github\.event\.workflow_run\.head_branch \}\}$/m,
    );
    assert.match(
      JOB,
      /^ {10}sha: \$\{\{ github\.event\.workflow_run\.head_sha \}\}$/m,
    );
  });
});

describe('deploy-production.yml — production is the release tags', () => {
  const CODE = withoutComments(PRODUCTION);
  const JOB = jobsOf(PRODUCTION).get('deploy');

  it('runs on a v* tag, or dispatched with a tag — a rollback', () => {
    assert.match(
      CODE,
      /^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n/m,
    );
    assert.doesNotMatch(CODE, /branches:/);
  });

  it('deploys one at a time, never cancelled, in the production environment the owner approves', () => {
    assert.match(
      CODE,
      /^concurrency:\n {2}group: deploy-production\n {2}cancel-in-progress: false\s*$/m,
    );
    assert.match(JOB, /^ {4}environment:\n {6}name: production\n/m);
  });

  it('grants the job an OIDC token and read access to CI’s verdict — nothing else', () => {
    assert.match(headOf(PRODUCTION), /^permissions:\n {2}contents: read\s*$/m);
    assert.match(
      JOB,
      /^ {4}permissions:\n {6}contents: read\n {6}id-token: write\n {6}actions: read\n {4}env:/m,
    );
  });

  it('refuses anything but a release tag, and a dispatch whose tag is not the ref it runs from', () => {
    assert.match(
      JOB,
      /case "\$GITHUB_REF" in\n {12}refs\/tags\/v\*\) ;;\n {12}\*\) echo "::error::.*"; exit 1 ;;/,
    );
    assert.match(
      JOB,
      /if \[ -n "\$REQUESTED_TAG" \] && \[ "refs\/tags\/\$REQUESTED_TAG" != "\$GITHUB_REF" \]; then/,
    );
    assert.match(JOB, /^ {6}REQUESTED_TAG: \$\{\{ inputs\.tag \}\}$/m);
  });

  it('proves CI passed on the tag’s commit as a push before anything deploys', () => {
    const steps = stepNames(
      PRODUCTION.slice(PRODUCTION.indexOf('\njobs:')).replace(/^ {2}/gm, ''),
    );
    assert.ok(
      steps.indexOf("CI passed on the tag's commit") < steps.indexOf(DEPLOY),
    );
    assert.match(
      JOB,
      /gh api "repos\/\$GITHUB_REPOSITORY\/actions\/workflows\/ci\.yml\/runs\?head_sha=\$GITHUB_SHA&event=push&status=success&per_page=1" --jq '\.total_count'/,
    );
    assert.match(JOB, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  });

  it('deploys the tag through the shared action as production', () => {
    assert.match(
      JOB,
      /- uses: actions\/checkout@[0-9a-f]{40}\n {8}with:\n {10}persist-credentials: false/,
    );
    assert.ok(usesOf(JOB).includes(DEPLOY));
    assert.match(JOB, /^ {10}environment: production$/m);
    assert.match(JOB, /^ {10}ref: \$\{\{ github\.ref \}\}$/m);
    assert.match(JOB, /^ {10}sha: \$\{\{ github\.sha \}\}$/m);
  });
});

describe('actions/deploy/action.yml — the runbook’s order, non-interactive', () => {
  const CODE = withoutComments(ACTION);
  const BODIES = runBodies(ACTION);

  it('is a composite action whose every script names its shell', () => {
    assert.match(CODE, /^ {2}using: composite\s*$/m);
    assert.equal(occurrences(CODE, 'shell: bash'), BODIES.length);
  });

  it('runs its steps in the order of docs/production-deploy.md §3', () => {
    assert.deepEqual(stepNames(ACTION), [
      'Name the release and the environment',
      'Point the checkout at the project',
      'Build the web for the environment',
      'The CSP the build needs is the one Hosting serves',
      'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',
      'Preflight, both scopes, before anything deploys',
      'Deploy the Firestore indexes and TTL policies (additive)',
      'Wait until every index is READY and every TTL ACTIVE',
      'Deploy the Firestore and Storage rules',
      'Deploy the functions',
      'Every callable answers the public, and no other function does',
      'Deploy hosting',
      'Smoke-check the live site',
    ]);
  });

  it('makes every callable public straight after the functions deploy, before hosting', () => {
    // firebase-tools grants a callable `allUsers` only on create; a callable
    // whose first create failed stays private (tools/release/callable-invokers.mjs).
    const guard =
      'node tools/release/callable-invokers.mjs --project "$PROJECT"';
    const functions = BODIES.indexOf(
      'pnpm exec firebase deploy --only functions --project "$PROJECT" --non-interactive --force',
    );
    assert.equal(BODIES[functions + 1], guard);
    assert.equal(
      occurrences(CODE, '--dry-run'),
      0,
      'the deploy grants, never only reports',
    );
  });

  it('names the build, the flag map and the App Check mode once, for every later step', () => {
    assert.match(
      BODIES[0],
      /stamp="\$\(node tools\/release\/release-stamp\.mjs --ref "\$RELEASE_REF" --sha "\$RELEASE_SHA"\)"/,
    );
    assert.match(
      BODIES[0],
      /echo "CREATIVO_RELEASE=\$stamp" >> "\$GITHUB_ENV"/,
    );
    assert.match(BODIES[0], /echo "FLAGS_ENV=\$ENVIRONMENT" >> "\$GITHUB_ENV"/);
  });

  it('builds the environment’s configuration with the stamp compiled in, cold', () => {
    assert.ok(
      BODIES.includes(
        `pnpm exec nx build web --configuration="$ENVIRONMENT" --skip-nx-cache "--define.CREATIVO_RELEASE=\\"'$CREATIVO_RELEASE'\\""`,
      ),
    );
  });

  it('runs the preflight first — both scopes, everything but what the index deploy settles', () => {
    const preflight = BODIES.find((body) => body.includes('--only P1,P4'));
    assert.match(
      preflight,
      /--scope web --only P1,P4,P5,P6,P10 --project "\$PROJECT"/,
    );
    assert.match(
      preflight,
      /--scope functions --only P6,P7,P8,P9,P10 --project "\$PROJECT"/,
    );
  });

  it('waits at most 40 × 30 s for P2 and P3, then fails', () => {
    const wait = BODIES.find((body) => body.includes('--only P2,P3'));
    assert.match(wait, /for attempt in \$\(seq 1 40\); do/);
    assert.match(wait, /sleep 30/);
    assert.match(wait, /exit 1\s*$/);
  });

  it('deploys each part non-interactively, to the project it was given', () => {
    const deploys = BODIES.filter((body) =>
      body.startsWith('pnpm exec firebase deploy'),
    );
    assert.deepEqual(
      deploys.map((body) => /--only (\S+)/.exec(body)[1]),
      [
        'firestore:indexes',
        'firestore:rules,storage',
        'functions',
        'hosting:web',
      ],
    );
    for (const body of deploys) {
      assert.match(body, / --project "\$PROJECT" --non-interactive/, body);
    }
    assert.match(deploys[3], /--message "release \$CREATIVO_RELEASE"$/);
  });

  it('forces the functions deploy and nothing else — never the indexes, whose --force drops an undeclared one', () => {
    assert.equal(occurrences(CODE, '--force'), 1, 'one --force in the action');
    assert.ok(
      BODIES.includes(
        'pnpm exec firebase deploy --only functions --project "$PROJECT" --non-interactive --force',
      ),
    );
    for (const text of [STAGING, PRODUCTION]) {
      assert.equal(occurrences(withoutComments(text), '--force'), 0);
    }
  });

  it('forces only what main.spec.ts pins: the export list and every export’s whole endpoint', () => {
    // What --force confirms — a deletion, a new retry flag, the instance
    // bounds — is reviewed as a diff of this literal before it deploys.
    const spec = read('apps/functions/src/main.spec.ts');
    assert.match(spec, /^const ENDPOINTS = \{$/m);
    assert.match(
      spec,
      /expect\(\[\.\.\.exported\.keys\(\)\]\.sort\(\)\)\.toEqual\(\[\.\.\.EXPORTS\]\);/,
    );
    assert.match(
      spec,
      /expect\(endpointOf\(exported\.get\(name\)\)\)\.toEqual\(ENDPOINTS\[name\]\);/,
    );
  });

  it('federates its identity — never a key — from the environment’s variables', () => {
    assert.match(
      CODE,
      /- uses: google-github-actions\/auth@[0-9a-f]{40}\n {6}with:\n {8}workload_identity_provider: \$\{\{ inputs\.workload-identity-provider \}\}\n {8}service_account: \$\{\{ inputs\.service-account \}\}/,
    );
  });

  it('smoke-checks the live site of the project for the stamp', () => {
    assert.equal(
      BODIES.at(-1),
      'node tools/release/smoke.mjs --origin "https://$PROJECT.web.app" --project "$PROJECT" --release "$CREATIVO_RELEASE"',
    );
  });
});
