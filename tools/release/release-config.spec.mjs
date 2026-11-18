// node --test tools/release/release-config.spec.mjs
//
// The commit grammar and the release configuration (ADR 2026-11-18,
// R3–R7), held together: commitlint.config.mjs is run through the real
// commitlint CLI — the one the `pr-title` job and the commit-msg hook run —
// on the titles this repository writes, release-please's own included; and
// release-please-config.json names a section for every type the grammar
// admits, versions the root package once, and stays pre-1.0.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMIT_TYPES, HEADER_MAX_LENGTH } from '../../commitlint.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const COMMITLINT = join(ROOT, 'node_modules', '.bin', 'commitlint');

/** commitlint's verdict on one message, as the pr-title job asks it (stdin). */
function lint(message) {
  const result = spawnSync(COMMITLINT, [], {
    cwd: ROOT,
    input: `${message}\n`,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, out: result.stdout + result.stderr };
}

describe('commitlint.config.mjs — the commit grammar', () => {
  it('admits exactly the ten types the ADR names', () => {
    assert.deepEqual(COMMIT_TYPES, [
      'feat',
      'fix',
      'perf',
      'refactor',
      'docs',
      'test',
      'build',
      'ci',
      'chore',
      'revert',
    ]);
    assert.equal(HEADER_MAX_LENGTH, 160);
  });

  it('passes the titles this repository writes — breaking marks, names first, long ones, release-please’s own', () => {
    for (const title of [
      'feat(team): «Моят профил» in the menu — a linked barber’s way back to their own page',
      'fix(identity): one sign-in code every ten seconds after a burst',
      'feat(analytics): Apple Health columns, Screen Time rows, carded modules',
      'feat(booking)!: a seat holds one service',
      'refactor!: the wire answers flat errors',
      'revert: feat(team): the welcome orbit',
      `docs: ${'x'.repeat(HEADER_MAX_LENGTH - 'docs: '.length)}`,
      // release-please's PR titles (`pull-request-title-pattern`): main's
      // and a hotfix branch's.
      'chore: release 0.1.0',
      'chore(release/v0.4): release 0.4.2',
    ]) {
      const verdict = lint(title);
      assert.ok(verdict.ok, `${title}\n${verdict.out}`);
    }
  });

  it('passes a squash commit whose body is a PR description — long lines, tables, a breaking footer', () => {
    const verdict = lint(
      [
        'feat(ci): staging on every merge',
        '',
        `| A | ${'long cell '.repeat(30)}|`,
        '',
        'BREAKING CHANGE: the deploy reads its project from the environment',
      ].join('\n'),
    );
    assert.ok(verdict.ok, verdict.out);
  });

  it('refuses what release-please could not read', () => {
    for (const title of [
      'Added the release flow',
      'feature(ci): an unknown type',
      'design(team): a type the grammar dropped',
      'Feat(ci): an upper-case type',
      'feat(CI): an upper-case scope',
      'feat(ci) no colon',
      'feat(ci):',
      `docs: ${'x'.repeat(HEADER_MAX_LENGTH)}`,
    ]) {
      assert.equal(lint(title).ok, false, title);
    }
  });
});

describe('release-please-config.json — one product, pre-1.0', () => {
  const config = readJson('release-please-config.json');
  const manifest = readJson('.release-please-manifest.json');
  const pkg = readJson('package.json');

  it('versions the root package alone, tagging vX.Y.Z with no component', () => {
    assert.deepEqual(Object.keys(config.packages), ['.']);
    assert.deepEqual(Object.keys(manifest), ['.']);
    assert.equal(config['release-type'], 'node');
    assert.equal(config['include-v-in-tag'], true);
    assert.equal(config['include-component-in-tag'], false);
    assert.equal(config.packages['.']['changelog-path'], 'CHANGELOG.md');
  });

  it('leaves the changelog to release-please: absent until the first release, never reformatted', () => {
    // release-please keeps a changelog with no version heading below the
    // first entry, its headings demoted (a stray «## Changelog» under 0.1.0:
    // src/updaters/changelog.ts, `adjustHeaders`), so there is no
    // placeholder before the first release; after it, «# Changelog» heads
    // the version entries.
    const changelog = join(ROOT, 'CHANGELOG.md');
    if (existsSync(changelog)) {
      const text = readFileSync(changelog, 'utf8');
      assert.match(text, /^# Changelog\n\n## \[?\d/);
      assert.doesNotMatch(text, /^## Changelog$/m);
    }
    // Its bullets and blank lines are release-please's: Prettier would
    // rewrite every release PR's entry and fail the static job's format check.
    assert.match(
      readFileSync(join(ROOT, '.prettierignore'), 'utf8'),
      /^\/CHANGELOG\.md$/m,
    );
  });

  it('keeps the manifest and package.json on the same version', () => {
    assert.equal(manifest['.'], pkg.version);
  });

  it('stays pre-1.0 until launch: the first release is 0.1.0, a breaking change bumps the minor', () => {
    // Without `initial-version`, release-please starts a 0.0.0 manifest at
    // 1.0.0 (its strategies' `initialReleaseVersion`).
    assert.equal(config.packages['.']['initial-version'], '0.1.0');
    assert.equal(config['bump-minor-pre-major'], true);
    assert.equal(config['bump-patch-for-minor-pre-major'], false);
  });

  it('starts the first changelog at the commit the release flow landed on', () => {
    assert.match(config['bootstrap-sha'], /^[0-9a-f]{40}$/);
  });

  it('names a changelog section for every commit type, and shows only what a person using the app notices', () => {
    const sections = config['changelog-sections'];
    assert.deepEqual(
      sections.map((section) => section.type).sort(),
      [...COMMIT_TYPES].sort(),
    );
    assert.deepEqual(
      sections.filter((section) => !section.hidden).map((s) => s.type),
      ['feat', 'fix', 'perf', 'revert'],
    );
  });

  it('titles its PR with a title the pr-title check admits', () => {
    assert.equal(
      config['pull-request-title-pattern'],
      'chore${scope}: release ${version}',
    );
    assert.match(config['pull-request-header'], /Agents never merge it\./);
  });
});
