// node --test tools/verify/ci/functions-package.spec.mjs
//
// The package Cloud Build installs (dist/apps/functions, ADR
// docs/architecture/decisions/2026-11-18-releases-and-environments.md, E6).
// Nx's generatePackageJson writes it from apps/functions/package.json plus
// every package the source imports, with a pruned pnpm-lock.yaml beside it.
// Seeing that lockfile, Cloud Build installs with pnpm, and then refuses the
// build unless the Functions Framework is a declared dependency — which no
// source file imports (the first staging deploy, 2026-11-19: every one of
// the 68 builds failed «you have not included the Functions Framework»).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));

const FRAMEWORK = '@google-cloud/functions-framework';

describe('apps/functions/package.json — the seed of the deployed package', () => {
  const seed = json('apps/functions/package.json');
  const root = json('package.json');

  it('declares the Functions Framework at exactly the root’s pinned version', () => {
    assert.match(root.dependencies[FRAMEWORK], /^\d+\.\d+\.\d+$/);
    assert.equal(seed.dependencies[FRAMEWORK], root.dependencies[FRAMEWORK]);
  });

  it('declares nothing else: every other dependency comes from the source’s imports, at the root’s version', () => {
    assert.deepEqual(Object.keys(seed.dependencies), [FRAMEWORK]);
    // No `imports` either: the root's `#eslint-config` would ride into dist,
    // so this project's ESLint config names the root one by path.
    for (const key of [
      'devDependencies',
      'peerDependencies',
      'scripts',
      'imports',
    ]) {
      assert.equal(seed[key], undefined, key);
    }
    assert.equal(seed.private, true);
  });

  it('leaves this project’s ESLint config the root config by path, since `#eslint-config` resolves through the nearest package.json', () => {
    assert.match(
      read('apps/functions/eslint.config.mjs'),
      /^\} from '\.\.\/\.\.\/eslint\.config\.mjs';$/m,
    );
  });

  it('is no pnpm workspace package: the root installs it', () => {
    const workspace = read('pnpm-workspace.yaml');
    assert.match(workspace, /^ {2}- 'apps\/\*'$/m);
    assert.match(workspace, /^ {2}- '!apps\/functions'$/m);
  });

  it('is what the functions build generates its package.json from, with the pruned lockfile', () => {
    const build = json('apps/functions/project.json').targets.build;
    assert.equal(build.executor, '@nx/esbuild:esbuild');
    assert.equal(build.options.generatePackageJson, true);
    assert.equal(build.options.outputPath, 'dist/apps/functions');
    assert.equal(json('firebase.json').functions.source, 'dist/apps/functions');
  });
});
