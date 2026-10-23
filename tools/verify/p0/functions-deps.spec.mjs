// node --test tools/verify/p0/functions-deps.spec.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  FORBIDDEN_FUNCTIONS_DEPS,
  checkFunctionsDeps,
  dependencyKeysOf,
  diffDependencyKeys,
  forbiddenDependencyKeys,
  recordFunctionsDeps,
} from './functions-deps.mjs';

function fixture(dependencies, baselineKeys) {
  const dir = mkdtempSync(join(tmpdir(), 'functions-deps-'));
  const packageJsonPath = join(dir, 'package.json');
  const baselinePath = join(dir, 'baseline.json');
  writeFileSync(
    packageJsonPath,
    JSON.stringify({ name: 'functions', dependencies }),
  );
  if (baselineKeys) {
    writeFileSync(baselinePath, JSON.stringify({ dependencies: baselineKeys }));
  }
  return { packageJsonPath, baselinePath };
}

/** The dist Phase 4b leaves (phase-4b-delete.md 4B-8; rxjs stays, 4a §10.1). */
const POST_4B = {
  'firebase-admin': '13.10.0',
  'firebase-functions': '7.2.5',
  'libphonenumber-js': '1.12.40',
  rxjs: '7.8.2',
};
const POST_4B_KEYS = Object.keys(POST_4B).sort();

/** Each package the end-of-3b assertion refuses, with a plausible version. */
const FORBIDDEN_SAMPLES = [
  ['@angular/core', '22.2.0'],
  ['@angular/compiler', '22.2.0'],
  ['luxon', '3.7.2'],
  ['@types/luxon', '3.7.1'],
  ['dinero.js', '2.0.0'],
];

describe('functions deps — the generated package.json against its baseline', () => {
  it('diffs keys both ways, sorted, ignoring order', () => {
    assert.deepEqual(diffDependencyKeys(['b', 'a'], ['a', 'b']), {
      added: [],
      removed: [],
    });
    assert.deepEqual(diffDependencyKeys(['z', 'a', 'c'], ['a', 'b']), {
      added: ['c', 'z'],
      removed: ['b'],
    });
  });

  it('reads only the dependency keys, sorted; none is an empty list', () => {
    assert.deepEqual(
      dependencyKeysOf('{"dependencies":{"rxjs":"7","luxon":"3"}}'),
      ['luxon', 'rxjs'],
    );
    assert.deepEqual(dependencyKeysOf('{"name":"functions"}'), []);
  });

  it('passes on the same keys whatever the versions', () => {
    const paths = fixture({ 'firebase-admin': '13.10.0', rxjs: '7.8.2' }, [
      'rxjs',
      'firebase-admin',
    ]);
    assert.match(checkFunctionsDeps(paths), /2 runtime dependencies/);
  });

  it('fails naming what the build added and what it dropped', () => {
    const paths = fixture(
      { 'firebase-admin': '13', '@typescript-eslint/parser': '8' },
      ['firebase-admin', 'rxjs'],
    );
    assert.throws(
      () => checkFunctionsDeps(paths),
      /added: @typescript-eslint\/parser[\s\S]*removed: rxjs/,
    );
  });

  it('says to build first when the package.json is missing', () => {
    assert.throws(
      () =>
        checkFunctionsDeps({
          packageJsonPath: join(tmpdir(), 'no-such-dir', 'package.json'),
        }),
      /pnpm nx build functions/,
    );
  });

  it('records the keys sorted, with the date given', () => {
    const paths = fixture({ rxjs: '7', 'firebase-admin': '13' }, null);
    recordFunctionsDeps({ ...paths, recordedAt: '2026-10-10' });
    const recorded = JSON.parse(readFileSync(paths.baselinePath, 'utf8'));
    assert.equal(recorded.recordedAt, '2026-10-10');
    assert.deepEqual(recorded.dependencies, ['firebase-admin', 'rxjs']);
    assert.match(checkFunctionsDeps(paths), /as recorded/);
  });
});

describe('functions deps — the end-of-3b assertion: no forbidden key', () => {
  it('forbids the Angular family, luxon, its types and dinero.js', () => {
    assert.deepEqual(
      forbiddenDependencyKeys([
        'rxjs',
        'dinero.js',
        '@angular/core',
        'firebase-admin',
        '@types/luxon',
        '@angular/compiler',
        'luxon',
      ]),
      [
        '@angular/compiler',
        '@angular/core',
        '@types/luxon',
        'dinero.js',
        'luxon',
      ],
    );
    assert.equal(FORBIDDEN_FUNCTIONS_DEPS.length, 4);
  });

  it('matches exact names and the @angular/ scope only, not look-alikes', () => {
    assert.deepEqual(
      forbiddenDependencyKeys([
        'angular',
        '@angular-devkit/core',
        '@angularx/core',
        'luxon-extra',
        '@types/luxon-extra',
        'dinero',
        '@dinero.js/core',
        'xdinero.js',
      ]),
      [],
    );
  });

  it('answers the same on a repeated call (no stateful matcher)', () => {
    const keys = ['@angular/core', '@angular/common'];
    assert.deepEqual(forbiddenDependencyKeys(keys), keys.slice().sort());
    assert.deepEqual(forbiddenDependencyKeys(keys), keys.slice().sort());
  });

  it('passes the dist Phase 4b leaves, and records it', () => {
    assert.deepEqual(forbiddenDependencyKeys(POST_4B_KEYS), []);
    const paths = fixture(POST_4B, null);
    assert.deepEqual(
      recordFunctionsDeps({ ...paths, recordedAt: '2026-10-22' }),
      POST_4B_KEYS,
    );
    assert.equal(
      checkFunctionsDeps(paths),
      `4 runtime dependencies, as recorded, none forbidden: ${POST_4B_KEYS.join(', ')}`,
    );
  });

  for (const [key, version] of FORBIDDEN_SAMPLES) {
    it(`fails the check on ${key} even when the baseline lists it`, () => {
      const paths = fixture({ ...POST_4B, [key]: version }, [
        ...POST_4B_KEYS,
        key,
      ]);
      assert.throws(
        () => checkFunctionsDeps(paths),
        (error) => {
          assert.match(error.message, /forbidden runtime dependency/);
          assert.ok(error.message.includes(`forbidden: ${key}`));
          assert.doesNotMatch(error.message, /no longer matches/);
          return true;
        },
      );
    });

    it(`fails the check on ${key} before it reads the baseline`, () => {
      const paths = fixture({ ...POST_4B, [key]: version }, null);
      assert.throws(
        () => checkFunctionsDeps(paths),
        (error) => {
          assert.ok(error.message.includes(`forbidden: ${key}`));
          assert.doesNotMatch(error.message, /--record/);
          return true;
        },
      );
    });

    it(`refuses to record ${key}, writing nothing`, () => {
      const fresh = fixture({ ...POST_4B, [key]: version }, null);
      assert.throws(
        () => recordFunctionsDeps({ ...fresh, recordedAt: '2026-10-22' }),
        (error) => error.message.includes(`forbidden: ${key}`),
      );
      assert.equal(existsSync(fresh.baselinePath), false);

      const recorded = fixture({ ...POST_4B, [key]: version }, POST_4B_KEYS);
      const before = readFileSync(recorded.baselinePath, 'utf8');
      assert.throws(
        () => recordFunctionsDeps({ ...recorded, recordedAt: '2026-10-22' }),
        /forbidden runtime dependency/,
      );
      assert.equal(readFileSync(recorded.baselinePath, 'utf8'), before);
    });
  }

  it('names every forbidden key at once, sorted', () => {
    const paths = fixture(
      { ...POST_4B, luxon: '3', 'dinero.js': '2', '@angular/core': '22' },
      null,
    );
    assert.throws(
      () => checkFunctionsDeps(paths),
      /forbidden: @angular\/core, dinero\.js, luxon/,
    );
  });
});
