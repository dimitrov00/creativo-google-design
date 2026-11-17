// node --test tools/release/smoke.spec.mjs
//
// The deploy's smoke check (ADR 2026-11-18, E6) over an in-memory site: it
// passes only when the served index, its policy, its initial scripts (the
// release stamp among them), a deep link and the service worker manifest
// are this release's — and retries a miss before it fails.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { functionsHost } from '../verify/csp/check-csp.mjs';
import {
  main,
  mainScriptOf,
  policyProblems,
  smoke,
  staticImportsOf,
} from './smoke.mjs';

const ORIGIN = 'https://creativo-v2-staging.web.app';
const PROJECT = 'creativo-v2-staging';
const RELEASE = '0.4.1+abc1234';
const POLICY = `default-src 'self'; connect-src 'self' https://firestore.googleapis.com ${functionsHost(PROJECT)}; object-src 'none'`;
const INDEX =
  '<!doctype html><html><head><script src="main-AB12CD34.js" type="module"></script></head><body><cr-root></cr-root></body></html>';

/** A served site: path → { status, text, csp }. */
function site(overrides = {}) {
  const pages = {
    '/': { status: 200, text: INDEX, csp: POLICY },
    '/book': { status: 200, text: INDEX, csp: POLICY },
    '/ngsw.json': { status: 200, text: '{}', csp: null },
    '/main-AB12CD34.js': {
      status: 200,
      text: 'import{a}from"./chunk-ONE.js";import"./chunk-TWO.js";const l=()=>import("./chunk-LAZY.js");',
    },
    '/chunk-ONE.js': {
      status: 200,
      text: 'import{b}from"./chunk-TWO.js";var x=1;',
    },
    '/chunk-TWO.js': { status: 200, text: `var Ut=\`${RELEASE}\`;` },
    '/chunk-LAZY.js': { status: 200, text: 'never read' },
    ...overrides,
  };
  const reads = [];
  return {
    reads,
    fetchText: async (url) => {
      const path = new URL(url).pathname;
      reads.push(path);
      return pages[path] ?? { status: 404, text: '', csp: null };
    },
  };
}

const noPause = async () => undefined;

describe('the pure parts', () => {
  it('finds the one main script, and refuses an index with none or two', () => {
    assert.equal(mainScriptOf(INDEX), 'main-AB12CD34.js');
    assert.equal(mainScriptOf('<html></html>'), null);
    assert.equal(
      mainScriptOf(
        '<script src="main-A.js"></script><script src="main-B.js"></script>',
      ),
      null,
    );
  });

  it('follows static imports only — never a dynamic import()', () => {
    assert.deepEqual(
      staticImportsOf(
        'import{a}from"./chunk-A.js";import"./chunk-B.js";import { c } from \'./chunk-C.js\';const l=()=>import("./chunk-LAZY.js");',
      ),
      ['./chunk-A.js', './chunk-B.js', './chunk-C.js'],
    );
  });

  it('requires the project’s callables host, alone, in the served policy', () => {
    assert.deepEqual(policyProblems(POLICY, PROJECT), []);
    assert.match(
      policyProblems(null, PROJECT)[0],
      /no Content-Security-Policy/,
    );
    assert.match(
      policyProblems(POLICY, 'creativo-v2-prod')[0],
      /not https:\/\/europe-west8-creativo-v2-prod/,
    );
    // A second callables host beside the project's is one too many.
    assert.match(
      policyProblems(
        POLICY.replace(
          functionsHost(PROJECT),
          `${functionsHost(PROJECT)} ${functionsHost('creativo-v2-other')}`,
        ),
        PROJECT,
      )[0],
      /connect-src names/,
    );
  });
});

describe('smoke', () => {
  it('passes a site that is this release, reading the initial graph and never a lazy chunk', async () => {
    const { fetchText, reads } = site();
    const problems = await smoke({
      origin: ORIGIN,
      project: PROJECT,
      release: RELEASE,
      fetchText,
      pause: noPause,
    });
    assert.deepEqual(problems, []);
    assert.ok(reads.includes('/chunk-TWO.js'));
    assert.ok(!reads.includes('/chunk-LAZY.js'));
    assert.equal(reads.filter((path) => path === '/chunk-TWO.js').length, 1);
  });

  it('fails a site still serving an older build — after retrying', async () => {
    const { fetchText } = site({
      '/chunk-TWO.js': { status: 200, text: 'var Ut=`0.4.0+fff0000`;' },
    });
    let pauses = 0;
    const problems = await smoke({
      origin: ORIGIN,
      project: PROJECT,
      release: RELEASE,
      fetchText,
      pause: async () => {
        pauses++;
      },
      attempts: 3,
    });
    assert.equal(pauses, 2);
    assert.match(problems.join('\n'), /an older build is still served/);
  });

  it('passes once a miss clears on a later attempt', async () => {
    let calls = 0;
    const { fetchText: served } = site();
    const fetchText = async (url) => {
      if (new URL(url).pathname === '/' && calls++ === 0) {
        return { status: 503, text: '', csp: null };
      }
      return served(url);
    };
    const problems = await smoke({
      origin: ORIGIN,
      project: PROJECT,
      release: RELEASE,
      fetchText,
      pause: noPause,
    });
    assert.deepEqual(problems, []);
  });

  it('names every failure: a policy for another project, a broken rewrite, no worker manifest, a missing chunk', async () => {
    const { fetchText } = site({
      '/': {
        status: 200,
        text: INDEX,
        csp: POLICY.replace(PROJECT, 'creativo-v2-prod'),
      },
      '/book': { status: 404, text: '', csp: null },
      '/ngsw.json': { status: 404, text: '', csp: null },
      '/chunk-ONE.js': { status: 404, text: '', csp: null },
    });
    const problems = await smoke({
      origin: ORIGIN,
      project: PROJECT,
      release: RELEASE,
      fetchText,
      pause: noPause,
      attempts: 1,
    });
    const text = problems.join('\n');
    assert.match(text, /connect-src names/);
    assert.match(text, /\/book answered 404/);
    assert.match(text, /\/ngsw\.json answered 404/);
    assert.match(text, /chunk-ONE\.js answered 404/);
  });

  it('turns a network failure into a failure, not a crash', async () => {
    const problems = await smoke({
      origin: ORIGIN,
      project: PROJECT,
      release: RELEASE,
      fetchText: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
      pause: noPause,
      attempts: 2,
    });
    assert.match(problems[0], /cannot read .*ENOTFOUND/);
  });
});

describe('main', () => {
  const run = async (args, fetchText = site().fetchText) => {
    const out = [];
    const err = [];
    const code = await main({
      args,
      fetchText,
      print: (text) => out.push(text),
      warn: (text) => err.push(text),
      pause: noPause,
    });
    return { code, out, err };
  };

  it('exits 0 on a pass, 1 on a failure, 2 on bad arguments', async () => {
    const args = [
      '--origin',
      ORIGIN,
      '--project',
      PROJECT,
      '--release',
      RELEASE,
    ];
    assert.equal((await run(args)).code, 0);
    assert.equal(
      (
        await run([
          '--origin',
          ORIGIN,
          '--project',
          PROJECT,
          '--release',
          '9.9.9',
        ])
      ).code,
      1,
    );
    assert.equal(
      (await run(['--origin', ORIGIN, '--project', PROJECT])).code,
      2,
    );
    assert.equal(
      (
        await run([
          '--origin',
          `${ORIGIN}/book`,
          '--project',
          PROJECT,
          '--release',
          RELEASE,
        ])
      ).code,
      2,
    );
    assert.equal(
      (
        await run([
          '--origin',
          'http://x.web.app',
          '--project',
          PROJECT,
          '--release',
          RELEASE,
        ])
      ).code,
      2,
    );
  });
});
