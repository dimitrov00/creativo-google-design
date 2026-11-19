// node --test tools/verify/csp/functions-region.spec.mjs
//
// The functions' region (ADR docs/architecture/decisions/2026-11-18-europe-west8-region.md),
// one value in four runtimes that cannot share a module — the functions'
// composition root, the web's callable client, the Node tools and the
// Playwright support — held equal here, read as text: every export is
// deployed there (setGlobalOptions, before the first definition), the web
// dials it, the CSP and the preflight name its host, the emulator journeys
// post to it, and nothing in the code names another region.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS_REGION, functionsHost } from './check-csp.mjs';
import { opsNamesOf } from '../preflight/preflight.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The TypeScript copies of the region, each `const FUNCTIONS_REGION = '…'`. */
const COPIES = [
  'apps/functions/src/lib/region.ts',
  'libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts',
  'apps/web/e2e/support/warm-callables.ts',
];

/** The one literal a copy declares. */
function regionOf(path) {
  const found = [
    ...read(path).matchAll(
      /^(?:export )?const FUNCTIONS_REGION = '([a-z0-9-]+)';$/gm,
    ),
  ];
  assert.equal(found.length, 1, `${path} declares FUNCTIONS_REGION once`);
  return found[0][1];
}

describe('the functions’ region (ADR 2026-11-18, europe-west8)', () => {
  it('is Milan, and every copy says so', () => {
    assert.equal(FUNCTIONS_REGION, 'europe-west8');
    for (const path of COPIES)
      assert.equal(regionOf(path), FUNCTIONS_REGION, path);
  });

  it('deploys every export there: setGlobalOptions once, before the first function is defined, and no export names its own region', () => {
    const main = read('apps/functions/src/main.ts');
    assert.match(
      main,
      /^import \{ FUNCTIONS_REGION \} from '\.\/lib\/region';$/m,
    );
    // The one call, whatever else it sets beside the region (the runtime
    // account, ADR 2026-11-19).
    const calls = [...main.matchAll(/setGlobalOptions\(\{[^}]*\}\);/g)];
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /\bregion: FUNCTIONS_REGION\b/);
    const first = Math.min(
      ...[
        ' = onCall(',
        ' = onSchedule(',
        ' = onDocumentWritten',
        ' = documentAuditTrigger(',
      ]
        .map((needle) => main.indexOf(needle))
        .filter((at) => at >= 0),
    );
    assert.ok(calls[0].index < first, 'set before the first definition');
    assert.doesNotMatch(main.replace(calls[0][0], ''), /\bregion:/);
  });

  it('has the web dial it', () => {
    assert.match(
      read('libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts'),
      /getFunctions\(\s*inject\(FIREBASE_APP\),\s*FUNCTIONS_REGION,?\s*\)/,
    );
  });

  it('names its host in the committed CSP — the one callables host there is', () => {
    const config = read('firebase.json');
    const hosts = [
      ...config.matchAll(/https:\/\/[a-z0-9-]+\.cloudfunctions\.net/g),
    ].map((match) => match[0]);
    assert.deepEqual(hosts, [functionsHost('creativo-replace-me')]);
  });

  it('has the emulator journeys post to it, by the tools’ one constant', () => {
    for (const path of [
      'tools/verify/p0/verify-p0.mjs',
      'tools/verify/app-check/verify-app-check.mjs',
    ]) {
      const text = read(path);
      assert.match(
        text,
        /^import \{ FUNCTIONS_REGION \} from '\.\.\/csp\/check-csp\.mjs';$/m,
        path,
      );
      assert.match(text, /^const REGION = FUNCTIONS_REGION;$/m, path);
    }
  });

  it('leaves no other region in the code', () => {
    const files = execFileSync(
      'git',
      ['ls-files', 'apps', 'libs', 'tools', 'firebase.json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter((path) => /\.(ts|mts|mjs|js|json)$/.test(path));
    const offenders = files.filter((path) =>
      /\b(?:us|europe|asia|australia|northamerica|southamerica|me|africa)-[a-z]+\d+\b/.test(
        read(path).replaceAll(FUNCTIONS_REGION, ''),
      ),
    );
    assert.deepEqual(offenders, []);
  });
});

// The same global options name the account every function runs as (ADR
// docs/architecture/decisions/2026-11-19-functions-runtime-identity.md, I1):
// the one tools/ops/deploy-identity.sh makes, by names.env's id.
describe('the functions’ runtime account (ADR 2026-11-19, I1)', () => {
  it('runs the functions as the account it makes — the global options name names.env’s runtime account id', () => {
    const names = opsNamesOf(read('tools/ops/names.env'));
    assert.equal(names.RUNTIME_SERVICE_ACCOUNT_ID, 'creativo-functions');
    const account = read('apps/functions/src/lib/runtime-account.ts');
    assert.equal(
      /^export const FUNCTIONS_SERVICE_ACCOUNT_ID = '([^']*)';$/m.exec(
        account,
      )?.[1],
      names.RUNTIME_SERVICE_ACCOUNT_ID,
    );
    // The full address, resolved per project at deploy — never the `name@`
    // shorthand, which Cloud Scheduler would receive unexpanded.
    assert.match(
      account,
      /^export const FUNCTIONS_SERVICE_ACCOUNT = expr`\$\{FUNCTIONS_SERVICE_ACCOUNT_ID\}@\$\{projectID\}\.iam\.gserviceaccount\.com`;$/m,
    );
    assert.match(
      read('apps/functions/src/main.ts'),
      /^setGlobalOptions\(\{\n {2}region: FUNCTIONS_REGION,\n {2}serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,\n\}\);$/m,
    );
  });
});
