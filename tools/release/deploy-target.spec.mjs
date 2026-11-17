// node --test tools/release/deploy-target.spec.mjs
//
// The deploy's checkout pointer (ADR 2026-11-18, E10): the committed
// firebase.json's one callables host swapped for the target project's and
// nothing else, .firebaserc's default and `web` target set to it, and a
// legacy, placeholder, demo or malformed project refused before anything is
// written. Run against the committed files: the shipped pair must point.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkArtifact,
  functionsHost,
  webHosting,
  headerOf,
  CSP_HEADER,
  parsePolicy,
} from '../verify/csp/check-csp.mjs';
import {
  main,
  pointFirebaseJson,
  pointFirebaserc,
  targetProblem,
} from './deploy-target.mjs';
import { LEGACY_PROJECT_IDS } from './legacy-projects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const FIREBASE_JSON = read('firebase.json');
const FIREBASERC = JSON.parse(read('.firebaserc'));
const COMMITTED = FIREBASERC.projects.default;
const TARGET = 'creativo-v2-staging';

/** One run of the command over in-memory files. */
function run(args, files = {}) {
  const store = {
    'firebase.json': FIREBASE_JSON,
    '.firebaserc': `${JSON.stringify(FIREBASERC, null, 2)}\n`,
    ...files,
  };
  const written = {};
  const out = [];
  const err = [];
  const code = main({
    args,
    readText: (path) => store[path],
    writeText: (path, text) => {
      written[path] = text;
    },
    print: (text) => out.push(text),
    warn: (text) => err.push(text),
  });
  return { code, written, out, err };
}

describe('targetProblem', () => {
  it('admits a real project id', () => {
    assert.equal(targetProblem('creativo-v2-prod'), null);
    assert.equal(targetProblem(TARGET), null);
  });

  it('refuses the legacy projects, the placeholder, a demo project, a malformed id and none', () => {
    for (const id of LEGACY_PROJECT_IDS) {
      assert.match(targetProblem(id), /old, live app/);
    }
    assert.match(targetProblem(COMMITTED), /placeholder/);
    assert.match(targetProblem('demo-creativo-test'), /demo project/);
    assert.match(
      targetProblem('Creativo_Prod'),
      /not a Google Cloud project id/,
    );
    assert.match(targetProblem(''), /no FIREBASE_PROJECT_ID/);
    assert.match(targetProblem(undefined), /no FIREBASE_PROJECT_ID/);
  });
});

describe('pointFirebaseJson', () => {
  it('swaps the committed callables host for the target’s — and changes nothing else', () => {
    const { text } = pointFirebaseJson(FIREBASE_JSON, COMMITTED, TARGET);
    assert.notEqual(text, FIREBASE_JSON);
    assert.equal(
      text.replace(functionsHost(TARGET), functionsHost(COMMITTED)),
      FIREBASE_JSON,
    );
    const policy = parsePolicy(
      headerOf(
        webHosting(JSON.parse(text)).headers.find(
          (rule) => rule.source === '**',
        ),
        CSP_HEADER,
      ),
    );
    assert.deepEqual(
      policy.get('connect-src').filter((s) => s.includes('cloudfunctions.net')),
      [functionsHost(TARGET)],
    );
  });

  it('leaves a checkout already pointed at the target as it is', () => {
    const once = pointFirebaseJson(FIREBASE_JSON, COMMITTED, TARGET).text;
    assert.deepEqual(pointFirebaseJson(once, COMMITTED, TARGET), {
      text: once,
    });
    assert.deepEqual(pointFirebaseJson(once, TARGET, TARGET), { text: once });
  });

  it('refuses a file that names the committed host other than once', () => {
    const twice = FIREBASE_JSON.replace(
      functionsHost(COMMITTED),
      `${functionsHost(COMMITTED)} ${functionsHost(COMMITTED)}`,
    );
    assert.match(
      pointFirebaseJson(twice, COMMITTED, TARGET).error,
      /2 time\(s\)/,
    );
    const none = FIREBASE_JSON.replace(functionsHost(COMMITTED), '');
    assert.match(
      pointFirebaseJson(none, COMMITTED, TARGET).error,
      /0 time\(s\)/,
    );
  });
});

describe('pointFirebaserc', () => {
  it('sets the default project and the web target on its default site, keeping the aliases', () => {
    const { rc } = pointFirebaserc(FIREBASERC, TARGET, 'staging');
    assert.equal(rc.projects.default, TARGET);
    assert.deepEqual(rc.targets[TARGET], { hosting: { web: [TARGET] } });
    assert.equal(rc.projects.staging, FIREBASERC.projects.staging);
    assert.equal(rc.projects.production, FIREBASERC.projects.production);
  });

  it('refuses an alias that names another real project — one source of truth', () => {
    const drifted = {
      ...FIREBASERC,
      projects: { ...FIREBASERC.projects, staging: 'creativo-v2-other' },
    };
    assert.match(
      pointFirebaserc(drifted, TARGET, 'staging').error,
      /alias names creativo-v2-other/,
    );
    const same = {
      ...FIREBASERC,
      projects: { ...FIREBASERC.projects, staging: TARGET },
    };
    assert.equal(pointFirebaserc(same, TARGET, 'staging').error, undefined);
  });
});

describe('main', () => {
  it('writes both files for a real project — and the CSP gate then reads the pointed project', () => {
    const { code, written, out } = run([
      '--project',
      TARGET,
      '--environment',
      'staging',
    ]);
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(written).sort(), [
      '.firebaserc',
      'firebase.json',
    ]);
    assert.match(out[0], /staging → creativo-v2-staging/);
    const config = JSON.parse(written['firebase.json']);
    const rc = JSON.parse(written['.firebaserc']);
    // Check (d) of the CSP gate, over the pointed pair.
    const failures = checkArtifact({
      config,
      html: '<!doctype html><html><body></body></html>',
      paths: [],
      projectId: rc.projects.default,
    });
    assert.ok(
      failures.every((failure) => !failure.startsWith('(d)')),
      failures.join('\n'),
    );
  });

  it('refuses every legacy project, writing nothing', () => {
    for (const id of LEGACY_PROJECT_IDS) {
      const { code, written, err } = run([
        '--project',
        id,
        '--environment',
        'production',
      ]);
      assert.equal(code, 1);
      assert.deepEqual(written, {});
      assert.match(err[0], /refused/);
    }
  });

  it('refuses an unknown environment or option with exit 2', () => {
    assert.equal(run(['--project', TARGET, '--environment', 'dev']).code, 2);
    assert.equal(run(['--project', TARGET]).code, 2);
    assert.equal(
      run(['--project', TARGET, '--environment', 'staging', '--force']).code,
      2,
    );
  });
});

describe('.firebaserc — the committed placeholders (ADR 2026-11-18, E10)', () => {
  it('names placeholder aliases for staging and production, each with a web target, and a placeholder default', () => {
    assert.deepEqual(Object.keys(FIREBASERC.projects).sort(), [
      'default',
      'production',
      'staging',
    ]);
    for (const alias of ['default', 'staging', 'production']) {
      assert.match(FIREBASERC.projects[alias], /replace-me/);
      assert.deepEqual(
        Object.keys(FIREBASERC.targets[FIREBASERC.projects[alias]].hosting),
        ['web'],
      );
    }
  });
});
