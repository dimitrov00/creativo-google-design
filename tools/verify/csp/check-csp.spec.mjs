// node --test tools/verify/csp/check-csp.spec.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  APP_CHECK_SOURCES,
  CSP_HEADER,
  SECURITY_HEADERS,
  appCheckFailures,
  checkArtifact,
  functionsHost,
  headerOf,
  parsePolicy,
  scriptHash,
  serializePolicy,
  webHosting,
} from './check-csp.mjs';

const PROJECT = 'demo-csp-spec';
const INLINE = 'window.__boot = true;';
const HTML = `<!doctype html><html><head><script>${INLINE}</script><script src="main-ABCD1234.js" type="module"></script></head><body><app-root></app-root></body></html>`;
const PATHS = [
  '/index.html',
  '/main-ABCD1234.js',
  '/chunk-EFGH5678.js',
  '/styles-IJKL9012.css',
  '/ngsw.json',
  '/ngsw-worker.js',
  '/manifest.webmanifest',
  '/assets/i18n/bg.json',
];

/** A policy's directives, in order — the five App Check sources included. */
function directives() {
  return new Map([
    ['default-src', ["'self'"]],
    [
      'script-src',
      ["'self'", ...APP_CHECK_SOURCES['script-src'], scriptHash(INLINE)],
    ],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    [
      'connect-src',
      [
        "'self'",
        'https://firestore.googleapis.com',
        ...APP_CHECK_SOURCES['connect-src'],
        functionsHost(PROJECT),
      ],
    ],
    ['frame-src', [...APP_CHECK_SOURCES['frame-src']]],
    ['object-src', ["'none'"]],
  ]);
}

/** A firebase.json whose web entry serves `policy` (a directives map) and `extra` hosting keys. */
function configWith(policy = directives(), extra = {}) {
  const security = SECURITY_HEADERS.map((key) => ({
    key,
    value: key === CSP_HEADER ? serializePolicy(policy) : 'set',
  }));
  const noCache = [{ key: 'Cache-Control', value: 'no-cache' }];
  return {
    hosting: [
      {
        target: 'web',
        public: 'dist',
        rewrites: [{ source: '**', destination: '/index.html' }],
        ...extra,
        headers: [
          { source: '**', headers: security },
          { source: '/', headers: noCache },
          { source: '**/!(*.*)', headers: noCache },
          {
            source:
              '/@(index.html|ngsw.json|ngsw-worker.js|safety-worker.js|worker-basic.min.js|manifest.webmanifest)',
            headers: noCache,
          },
          { source: '/assets/i18n/*.json', headers: noCache },
          {
            source: '/@(main|polyfills|chunk|styles)-*.@(js|css)',
            headers: [
              {
                key: 'Cache-Control',
                value: 'public, max-age=31536000, immutable',
              },
            ],
          },
        ],
      },
    ],
  };
}

function check(config, html = HTML) {
  return checkArtifact({ config, html, paths: PATHS, projectId: PROJECT });
}

/** The directives with `name`'s sources replaced by `sources`. */
function withDirective(name, sources) {
  const policy = directives();
  policy.set(name, sources);
  return policy;
}

/** The failures of one check letter, e.g. `'(f)'`. */
function of(letter, failures) {
  return failures.filter((failure) => failure.startsWith(letter));
}

describe('checkArtifact — (a)–(e)', () => {
  it('passes a config and an artifact that agree', () => {
    assert.deepEqual(check(configWith()), []);
  });

  it('(a) reports a missing security header', () => {
    const config = configWith();
    const all = webHosting(config).headers[0];
    all.headers = all.headers.filter(
      (header) => header.key !== 'X-Frame-Options',
    );
    assert.deepEqual(of('(a)', check(config)), [
      '(a) missing header X-Frame-Options',
    ]);
  });

  it('(b) refuses unsafe keywords, nonces, wildcards and bare schemes', () => {
    const script = [
      "'self'",
      ...APP_CHECK_SOURCES['script-src'],
      scriptHash(INLINE),
      "'unsafe-inline'",
      "'nonce-abc'",
      'https://*.example.com',
      'https:',
    ];
    const failures = of(
      '(b)',
      check(configWith(withDirective('script-src', script))),
    );
    assert.equal(failures.length, 4);
    assert.ok(failures.some((failure) => failure.includes("'unsafe-inline'")));
    assert.ok(failures.some((failure) => failure.includes('nonce')));
    assert.ok(failures.some((failure) => failure.includes('wildcard')));
    assert.ok(failures.some((failure) => failure.includes('whole scheme')));
  });

  it("(b) refuses a script-src without 'self'", () => {
    const script = [...APP_CHECK_SOURCES['script-src'], scriptHash(INLINE)];
    assert.deepEqual(
      of('(b)', check(configWith(withDirective('script-src', script)))),
      ["(b) script-src lacks 'self'"],
    );
  });

  it('(c) wants exactly the inline scripts’ hashes, and no inline handler', () => {
    const html = HTML.replace(INLINE, 'window.__boot = false;').replace(
      '<app-root>',
      '<app-root onclick="go()">',
    );
    const failures = of('(c)', check(configWith(), html));
    assert.ok(failures.some((failure) => failure.includes('does not list')));
    assert.ok(
      failures.some((failure) =>
        failure.includes('which no inline script has'),
      ),
    );
    assert.ok(
      failures.some((failure) => failure.includes('the artifact needs')),
    );
    assert.ok(failures.some((failure) => failure.includes('inline handler')));
  });

  it('(d) wants exactly the default project’s callables host', () => {
    const connect = [
      "'self'",
      ...APP_CHECK_SOURCES['connect-src'],
      functionsHost('another-project'),
    ];
    assert.equal(
      of('(d)', check(configWith(withDirective('connect-src', connect))))
        .length,
      1,
    );
  });

  it('(e) wants a hashed asset immutable and index.html revalidated', () => {
    const config = configWith();
    webHosting(config).headers = webHosting(config).headers.filter(
      (rule) => !rule.source.startsWith('/@('),
    );
    const failures = of('(e)', check(config));
    assert.ok(failures.some((failure) => failure.startsWith('(e) /main-')));
    assert.ok(
      failures.some((failure) => failure.startsWith('(e) /index.html')),
    );
  });
});

describe('checkArtifact — (f) the App Check sources', () => {
  it('names five sources over three directives, path-scoped and exact', () => {
    assert.deepEqual(Object.keys(APP_CHECK_SOURCES), [
      'script-src',
      'frame-src',
      'connect-src',
    ]);
    const all = Object.values(APP_CHECK_SOURCES).flat();
    assert.equal(all.length, 5);
    for (const source of all) {
      const url = new URL(source);
      assert.equal(url.protocol, 'https:', source);
      assert.equal(url.search + url.hash, '', source);
      assert.ok(!source.includes('*'), source);
    }
    // Every reCAPTCHA source is scoped to the /recaptcha/ path, never the host.
    for (const source of [
      ...APP_CHECK_SOURCES['script-src'],
      ...APP_CHECK_SOURCES['frame-src'],
    ]) {
      assert.equal(new URL(source).pathname, '/recaptcha/', source);
    }
    assert.deepEqual(APP_CHECK_SOURCES['connect-src'], [
      'https://content-firebaseappcheck.googleapis.com',
    ]);
  });

  it('passes a policy with the five sources', () => {
    assert.deepEqual(appCheckFailures(directives()), []);
    assert.deepEqual(of('(f)', check(configWith())), []);
  });

  it('fails a policy missing one of them', () => {
    for (const [directive, sources] of Object.entries(APP_CHECK_SOURCES)) {
      for (const source of sources) {
        const policy = withDirective(
          directive,
          directives()
            .get(directive)
            .filter((entry) => entry !== source),
        );
        const failures = appCheckFailures(policy);
        assert.equal(failures.length, 1, `${directive} without ${source}`);
        assert.ok(failures[0].includes(directive));
      }
    }
  });

  it('fails an extra third-party script-src host', () => {
    const script = [
      ...directives().get('script-src'),
      'https://cdn.example.com',
    ];
    assert.deepEqual(appCheckFailures(withDirective('script-src', script)), [
      '(f) script-src admits a host App Check does not need (https://cdn.example.com)',
    ]);
  });

  it('fails the bare www.google.com host in script-src (the path scope is the point)', () => {
    const script = [
      ...directives().get('script-src'),
      'https://www.google.com',
    ];
    assert.equal(
      appCheckFailures(withDirective('script-src', script)).length,
      1,
    );
  });

  it('fails an extra frame-src host', () => {
    const frame = [
      ...APP_CHECK_SOURCES['frame-src'],
      'https://frames.example.com',
    ];
    assert.equal(appCheckFailures(withDirective('frame-src', frame)).length, 1);
  });

  it("fails frame-src 'none' and a policy with no frame-src", () => {
    assert.equal(
      appCheckFailures(withDirective('frame-src', ["'none'"])).length,
      1,
    );
    const policy = directives();
    policy.delete('frame-src');
    assert.equal(appCheckFailures(policy).length, 1);
  });

  it('fails a wildcard in each of the three directives', () => {
    const wildcards = {
      'script-src': 'https://*.google.com/recaptcha/',
      'frame-src': 'https://*.google.com',
      'connect-src': 'https://*.googleapis.com',
    };
    for (const [directive, wildcard] of Object.entries(wildcards)) {
      const policy = withDirective(directive, [
        ...directives().get(directive),
        wildcard,
      ]);
      const failures = appCheckFailures(policy);
      assert.ok(
        failures.includes(`(f) ${directive} carries a wildcard (${wildcard})`),
        directive,
      );
    }
  });

  it('runs inside checkArtifact', () => {
    const failures = check(configWith(withDirective('frame-src', ["'none'"])));
    assert.equal(of('(f)', failures).length, 1);
  });
});

describe('checkArtifact — (g) no redirects', () => {
  it('fails a web hosting entry that declares redirects', () => {
    const config = configWith(directives(), {
      redirects: [{ source: '/old', destination: '/new', type: 301 }],
    });
    const failures = of('(g)', check(config));
    assert.equal(failures.length, 1);
    assert.ok(failures[0].includes('redirects'));
  });

  it('passes an entry with only rewrites', () => {
    assert.deepEqual(of('(g)', check(configWith())), []);
  });
});

describe('the real firebase.json', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../firebase.json', import.meta.url), 'utf8'),
  );
  const hosting = webHosting(config);
  const all = hosting.headers.find((rule) => rule.source === '**');
  const policy = parsePolicy(headerOf(all, CSP_HEADER));

  it('passes (f): the five App Check sources, exactly where they belong', () => {
    assert.deepEqual(appCheckFailures(policy), []);
    assert.deepEqual(policy.get('frame-src'), APP_CHECK_SOURCES['frame-src']);
  });

  it('passes (g): no redirects', () => {
    assert.equal(hosting.redirects, undefined);
    const failures = checkArtifact({
      config,
      html: HTML,
      paths: [],
      projectId: PROJECT,
    });
    assert.deepEqual(of('(f)', failures), []);
    assert.deepEqual(of('(g)', failures), []);
  });
});
