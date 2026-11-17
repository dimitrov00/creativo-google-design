// node --test tools/release/release-stamp.spec.mjs
//
// The release stamp (ADR 2026-11-18, R9): a tag build is its release, a
// branch build the manifest's version plus the short sha, and every stamp
// fits the one shape the functions (`apps/functions/src/lib/release.ts`),
// the flags writer and the web's issue rule admit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RELEASE_SHAPE } from '../flags/write-functions-env.mjs';
import { main, releaseStamp } from './release-stamp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('releaseStamp', () => {
  it('names a tag build by its release', () => {
    assert.deepEqual(
      releaseStamp({ version: '0.4.1', ref: 'refs/tags/v0.4.1', sha: SHA }),
      { stamp: '0.4.1' },
    );
  });

  it('refuses a tag the manifest does not name', () => {
    const { error } = releaseStamp({
      version: '0.4.1',
      ref: 'refs/tags/v0.4.2',
      sha: SHA,
    });
    assert.match(
      error,
      /the tag v0\.4\.2 is not the release package\.json names \(v0\.4\.1\)/,
    );
    assert.match(
      releaseStamp({ version: '0.4.1', ref: 'refs/tags/0.4.1' }).error,
      /is not the release/,
    );
  });

  it('names a branch build by the manifest’s version and the short sha', () => {
    for (const ref of ['refs/heads/main', 'refs/heads/release/v0.4']) {
      assert.deepEqual(releaseStamp({ version: '0.4.1', ref, sha: SHA }), {
        stamp: '0.4.1+0123456',
      });
    }
  });

  it('refuses a branch build without its commit, a ref of no kind, a manifest of no version', () => {
    assert.match(
      releaseStamp({ version: '0.4.1', ref: 'refs/heads/main' }).error,
      /needs its commit/,
    );
    assert.match(
      releaseStamp({ version: '0.4.1', ref: 'refs/heads/main', sha: 'HEAD' })
        .error,
      /no sha/,
    );
    assert.match(
      releaseStamp({ version: '0.4.1', ref: 'refs/pull/7/merge', sha: SHA })
        .error,
      /neither a branch nor a tag/,
    );
    assert.match(releaseStamp({ version: '0.4.1', sha: SHA }).error, /no ref/);
    for (const version of ['0.4', 'v0.4.1', '0.4.1-rc.1', undefined]) {
      assert.match(
        releaseStamp({ version, ref: 'refs/heads/main', sha: SHA }).error,
        /is not X\.Y\.Z/,
      );
    }
  });

  it('only ever names a stamp every reader admits', () => {
    for (const ref of ['refs/tags/v123.456.789', 'refs/heads/main']) {
      const { stamp } = releaseStamp({ version: '123.456.789', ref, sha: SHA });
      assert.match(stamp, RELEASE_SHAPE);
      // The web's define and the functions' rule: no quote, no space.
      assert.doesNotMatch(stamp, /['"\s]/);
    }
  });
});

describe('main', () => {
  const run = (args, version = '0.4.1') => {
    const out = [];
    const err = [];
    const code = main({
      args,
      readVersion: () => version,
      print: (text) => out.push(text),
      warn: (text) => err.push(text),
    });
    return { code, out, err };
  };

  it('prints the stamp alone and exits 0', () => {
    assert.deepEqual(run(['--ref', 'refs/heads/main', '--sha', SHA]), {
      code: 0,
      out: ['0.4.1+0123456'],
      err: [],
    });
  });

  it('exits 1 when no stamp can be named, 2 on an unknown option', () => {
    const refused = run(['--ref', 'refs/tags/v9.9.9']);
    assert.equal(refused.code, 1);
    assert.deepEqual(refused.out, []);
    assert.equal(run(['--tag', 'v0.4.1']).code, 2);
  });

  it('reads the root package.json when run as a command', () => {
    const { version } = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    );
    const result = spawnSync(
      process.execPath,
      ['tools/release/release-stamp.mjs', '--ref', `refs/tags/v${version}`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}\n`);
  });
});
