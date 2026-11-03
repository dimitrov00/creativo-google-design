// node --test tools/verify/typecheck/out-dirs.spec.mjs
//
// The output-folder rule of out-dirs.mjs: what each config must state, the
// refusals (a generator's shared folder, a missing or derived build-info
// file, two configs on one folder), comments in a config, and the real tree.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  expectedOutput,
  outDirProblems,
  repositoryProblems,
  statedOptions,
} from './out-dirs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const owned = (path) => ({ path, options: expectedOutput(path) });

describe('typecheck output folders', () => {
  it('puts each config in dist/out-tsc/<project>/<kind>, its build info inside', () => {
    assert.deepEqual(expectedOutput('libs/ecs-core/tsconfig.lib.json'), {
      outDir: '../../dist/out-tsc/libs/ecs-core/lib',
      tsBuildInfoFile:
        '../../dist/out-tsc/libs/ecs-core/lib/tsconfig.lib.tsbuildinfo',
    });
    assert.deepEqual(
      expectedOutput('libs/features/admin/loyalty/tsconfig.spec.json'),
      {
        outDir: '../../../../dist/out-tsc/libs/features/admin/loyalty/spec',
        tsBuildInfoFile:
          '../../../../dist/out-tsc/libs/features/admin/loyalty/spec/tsconfig.spec.tsbuildinfo',
      },
    );
    assert.equal(
      expectedOutput('tools/seed/tsconfig.fixtures.json').outDir,
      '../../dist/out-tsc/tools/seed/fixtures',
    );
  });

  it('accepts configs that each own their folder', () => {
    assert.deepEqual(
      outDirProblems([
        owned('libs/ecs-core/tsconfig.lib.json'),
        owned('libs/ecs-core/tsconfig.spec.json'),
        owned('apps/web/tsconfig.app.json'),
      ]),
      [],
    );
  });

  it('refuses the shared folder a generator writes, and a missing build-info file', () => {
    const problems = outDirProblems([
      {
        path: 'libs/ui/new/tsconfig.lib.json',
        options: { outDir: '../../../dist/out-tsc' },
      },
    ]);
    assert.equal(problems.length, 2);
    assert.match(
      problems[0],
      /outDir is "\.\.\/\.\.\/\.\.\/dist\/out-tsc", expected "\.\.\/\.\.\/\.\.\/dist\/out-tsc\/libs\/ui\/new\/lib"/,
    );
    assert.match(problems[1], /tsBuildInfoFile is undefined/);
  });

  it('refuses a config with no outDir (tsc would emit beside the sources)', () => {
    const [problem] = outDirProblems([
      { path: 'libs/ui/new/tsconfig.spec.json', options: {} },
    ]);
    assert.match(problem, /outDir is undefined/);
  });

  it('refuses two configs on one folder', () => {
    const lib = owned('libs/ui/a/tsconfig.lib.json');
    const copy = { path: 'libs/ui/a/tsconfig.spec.json', options: lib.options };
    const problems = outDirProblems([lib, copy]);
    assert.ok(
      problems.some((p) =>
        /tsconfig\.spec\.json: shares its outDir with libs\/ui\/a\/tsconfig\.lib\.json/.test(
          p,
        ),
      ),
    );
  });

  it('reads a config with comments and trailing commas, as tsc does', () => {
    const options = statedOptions(
      '{\n  // why\n  "compilerOptions": { "outDir": "x", },\n}\n',
      'libs/x/tsconfig.lib.json',
    );
    assert.equal(options.outDir, 'x');
  });

  it('holds on the repository: every config owns its folder', () => {
    const { count, problems } = repositoryProblems(ROOT);
    assert.deepEqual(problems, []);
    assert.ok(count >= 79, `found ${count} configs`);
  });
});
