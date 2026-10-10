// node --test tools/verify/p0/functions-deps.spec.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkFunctionsDeps,
  dependencyKeysOf,
  diffDependencyKeys,
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
