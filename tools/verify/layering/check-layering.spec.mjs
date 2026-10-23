// node --test tools/verify/layering/check-layering.spec.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  CORE_SRC,
  LEGACY_ALIAS,
  TIER_ALIASES,
  checkBarrels,
  checkCycles,
  checkDeepRelative,
  checkEntryPoints,
  checkHierarchy,
  checkLayering,
  checkNameHomes,
  checkTsconfigPaths,
  climbsOf,
  exportedNames,
  extractImports,
  formatViolation,
  hasParentSegment,
  hierarchyBreach,
  importGraph,
  isTestFile,
  leafBreach,
  loadWorkspace,
  resolveSpecifier,
  stronglyConnected,
  tierOf,
} from './check-layering.mjs';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-layering.mjs',
);

const core = (path) => `${CORE_SRC}/${path}`;

/** tsconfig.base.json text with the given `paths`. */
function tsconfigText(paths) {
  return `${JSON.stringify({ compilerOptions: { paths } }, null, 2)}\n`;
}

const LAW_PATHS = Object.fromEntries(
  [...TIER_ALIASES].map(([alias, barrel]) => [alias, [barrel]]),
);

/** A small library that obeys Law 8 everywhere. */
function cleanFiles() {
  return new Map([
    [core('package.json'), '{ "sideEffects": false }\n'],
    [core('primitives/index.ts'), "export * from './minute.primitive';\n"],
    [core('primitives/minute.primitive.ts'), 'export type Minute = number;\n'],
    [core('errors/index.ts'), "export * from './slot.error';\n"],
    [
      core('errors/slot.error.ts'),
      "import type { Minute } from '@core/primitives';\nexport type SlotError = { readonly errorCode: 'SLOT_TAKEN'; readonly start: Minute };\n",
    ],
    [core('components/index.ts'), "export * from './slot.data';\n"],
    [
      core('components/slot.data.ts'),
      "import type { Minute } from '@core/primitives';\nexport type Slot = { readonly start: Minute };\n",
    ],
    [
      core('components/slot.data.spec.ts'),
      "import { fixture } from '@core/testing';\nimport { SlotSystem } from '@core/systems';\nexport const probe = [fixture, SlotSystem];\n",
    ],
    [core('entities/index.ts'), "export * from './visit.entity';\n"],
    [
      core('entities/visit.entity.ts'),
      "import type { Slot } from '@core/components';\nimport type { Minute } from '@core/primitives';\nexport type Visit = Slot & { readonly length: Minute };\n",
    ],
    [core('ports/index.ts'), "export type * from './visits.port';\n"],
    [
      core('ports/visits.port.ts'),
      "import type { Visit } from '@core/entities';\nexport type ReadVisits = () => Promise<readonly Visit[]>;\n",
    ],
    [
      core('systems/index.ts'),
      "export * from './slot.system';\nexport { other } from './other.system';\n",
    ],
    [
      core('systems/slot.system.ts'),
      "import type { Visit } from '@core/entities';\nimport type { Slot } from '@core/components';\nimport { other } from './other.system';\nexport const SlotSystem = { end: (visit: Visit, slot: Slot) => other(visit.length + slot.start) };\n",
    ],
    [
      core('systems/other.system.ts'),
      'export const other = (value: number) => value;\n',
    ],
    [core('pipelines/index.ts'), 'export {};\n'],
    [core('testing/index.ts'), "export * from './fixtures';\n"],
    [
      core('testing/fixtures.ts'),
      "import { SlotSystem } from '@core/systems';\nimport type { ReadVisits } from '@core/ports';\nimport * as pipelines from '@core/pipelines';\nexport const fixture = { SlotSystem, pipelines } satisfies Record<string, unknown>;\nexport type Reader = ReadVisits;\n",
    ],
    [
      'apps/web/src/app/app.config.ts',
      "import { SlotSystem } from '@core/systems';\nimport { environment } from '../environments/environment';\nexport const config = { SlotSystem, environment };\n",
    ],
  ]);
}

function snapshotOf(files = cleanFiles(), paths = LAW_PATHS) {
  return {
    files,
    tsconfigBase:
      paths === null
        ? null
        : { path: 'tsconfig.base.json', text: tsconfigText(paths) },
  };
}

function withFiles(entries) {
  const files = cleanFiles();
  for (const [path, text] of Object.entries(entries)) {
    if (text === null) files.delete(path);
    else files.set(path, text);
  }
  return files;
}

const where = (violations) =>
  violations.map(({ file, line }) => `${file}:${line}`);

describe('extractImports — every module specifier a file names', () => {
  it('reads static, re-export, dynamic, require, mock and type-position specifiers with their lines', () => {
    const found = extractImports(
      'a.ts',
      [
        "import { a } from './a';",
        "import type { B } from './b';",
        "import { type C, type D } from './c';",
        "import E, { type F } from './e';",
        "export * from './g';",
        "export type * from './h';",
        "export { type I } from './i';",
        'export {};',
        "const j = await import('./j');",
        "const k = require('./k');",
        "vi.mock('./l');",
        "type M = import('./m').M;",
        "import n = require('./n');",
        "// import o from '../../../o';",
        "const p = resolve(__dirname, '../../../p.css');",
      ].join('\n'),
    );
    assert.deepEqual(found, [
      { specifier: './a', line: 1, typeOnly: false },
      { specifier: './b', line: 2, typeOnly: true },
      { specifier: './c', line: 3, typeOnly: true },
      { specifier: './e', line: 4, typeOnly: false },
      { specifier: './g', line: 5, typeOnly: false },
      { specifier: './h', line: 6, typeOnly: true },
      { specifier: './i', line: 7, typeOnly: true },
      { specifier: './j', line: 9, typeOnly: false },
      { specifier: './k', line: 10, typeOnly: false },
      { specifier: './l', line: 11, typeOnly: false },
      { specifier: './m', line: 12, typeOnly: true },
      { specifier: './n', line: 13, typeOnly: false },
    ]);
  });

  it('parses JavaScript modules too', () => {
    assert.deepEqual(
      extractImports(
        'eslint.config.mjs',
        "import base from '../../eslint.config.mjs';\nexport default [...base];\n",
      ),
      [{ specifier: '../../eslint.config.mjs', line: 1, typeOnly: false }],
    );
  });
});

describe('the library layout', () => {
  it('knows the tier of a library file, and null at the src root or outside', () => {
    assert.equal(tierOf(core('systems/a.system.ts')), 'systems');
    assert.equal(tierOf(core('testing/fixtures/loyalty/a.json')), 'testing');
    assert.equal(tierOf(core('index.ts')), null);
    assert.equal(tierOf('libs/other/src/systems/a.ts'), null);
  });

  it('treats specs, type-specs and tests as test files', () => {
    assert.equal(isTestFile('a.system.spec.ts'), true);
    assert.equal(isTestFile('a-dictionaries.type-spec.ts'), true);
    assert.equal(isTestFile('a.test.ts'), true);
    assert.equal(isTestFile('a.system.ts'), false);
    assert.equal(isTestFile('spec-support.ts'), false);
  });

  it('counts the levels a relative specifier climbs once normalised', () => {
    assert.equal(climbsOf('./a'), 0);
    assert.equal(climbsOf('../a'), 1);
    assert.equal(climbsOf('..'), 1);
    assert.equal(climbsOf('./../../a'), 2);
    assert.equal(climbsOf('../../..'), 3);
    assert.equal(climbsOf('../a/../../b/../../c'), 3);
    assert.equal(climbsOf('@core/systems'), 0);
    assert.equal(climbsOf('rxjs/operators'), 0);
  });

  it('finds a parent segment anywhere in a relative specifier', () => {
    for (const specifier of ['..', '../a', './../a', './a/../b', './a/..']) {
      assert.equal(hasParentSegment(specifier), true, specifier);
    }
    for (const specifier of [
      './a',
      './..a',
      './a..',
      '@core/systems',
      'rxjs',
    ]) {
      assert.equal(hasParentSegment(specifier), false, specifier);
    }
  });

  it('resolves relative and tier-alias specifiers to snapshot files', () => {
    const files = cleanFiles();
    const from = core('systems/slot.system.ts');
    assert.equal(
      resolveSpecifier(files, from, './other.system'),
      core('systems/other.system.ts'),
    );
    assert.equal(
      resolveSpecifier(files, from, '../components/slot.data'),
      core('components/slot.data.ts'),
    );
    assert.equal(
      resolveSpecifier(files, from, '@core/entities'),
      core('entities/index.ts'),
    );
    assert.equal(resolveSpecifier(files, from, '@core/entities/x'), null);
    assert.equal(resolveSpecifier(files, from, '@core/kernel'), null);
    assert.equal(resolveSpecifier(files, from, 'rxjs'), null);
    assert.equal(resolveSpecifier(files, from, './missing'), null);
  });
});

describe('(a) entry points', () => {
  it('passes a library with tier barrels only and the eight aliases', () => {
    assert.deepEqual(checkEntryPoints(snapshotOf()), []);
  });

  it('rejects a root barrel and any other module directly in src/', () => {
    const found = checkEntryPoints(
      snapshotOf(
        withFiles({
          [core('index.ts')]: "export * from './primitives';\n",
          [core('testing.ts')]: "export * from './testing';\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [
      `${core('index.ts')}:1`,
      `${core('testing.ts')}:1`,
    ]);
    assert.match(found[0].message, /no root barrel/);
  });

  it('finds the retired alias in any text file, with its line', () => {
    const found = checkEntryPoints(
      snapshotOf(
        withFiles({
          'apps/web/src/main.ts': `import { a } from '@core/systems';\nimport { b } from '${LEGACY_ALIAS}';\n`,
          'tools/notes/README.md': `Old: ${LEGACY_ALIAS}/testing\n`,
        }),
      ),
    );
    assert.deepEqual(where(found), [
      'apps/web/src/main.ts:2',
      'tools/notes/README.md:1',
    ]);
  });

  it('requires exactly the eight tier aliases in tsconfig.base.json', () => {
    const paths = {
      '@creativo/ui/icons': ['./libs/ui/icons/src/index.ts'],
      [LEGACY_ALIAS]: ['./libs/ecs-core/src/index.ts'],
      ...LAW_PATHS,
      '@core/systems': ['libs/ecs-core/src/systems/index.ts'],
      '@core/kernel': ['./libs/ecs-core/src/kernel/index.ts'],
    };
    delete paths['@core/pipelines'];
    const text = tsconfigText(paths);
    const found = checkTsconfigPaths({ path: 'tsconfig.base.json', text });
    const lineOf = (needle) =>
      text.split('\n').findIndex((line) => line.includes(needle)) + 1;
    assert.deepEqual(
      found.map(({ line }) => line),
      [
        lineOf(`"${LEGACY_ALIAS}"`),
        lineOf('"@core/systems"'),
        lineOf('"@core/kernel"'),
        lineOf('"paths"'),
      ],
    );
    assert.match(found[0].message, /is the retired root alias/);
    assert.match(
      found[1].message,
      /"@core\/systems" must map to \["\.\/libs\/ecs-core\/src\/systems\/index\.ts"\]/,
    );
    assert.match(found[2].message, /is not one of the eight tier aliases/);
    assert.match(found[3].message, /"@core\/pipelines" is missing/);
  });

  it('reports an unparsable tsconfig instead of passing it', () => {
    const found = checkTsconfigPaths({
      path: 'tsconfig.base.json',
      text: '{ "compilerOptions": ',
    });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /^Cannot parse/);
  });
});

describe('(b) hierarchy — the tier each folder may import', () => {
  const production = {
    primitives: core('primitives/a.primitive.ts'),
    errors: core('errors/a.error.ts'),
    components: core('components/a.data.ts'),
    entities: core('entities/a.entity.ts'),
    ports: core('ports/a.port.ts'),
    systems: core('systems/a.system.ts'),
    pipelines: core('pipelines/a.pipeline.ts'),
    testing: core('testing/a.fixtures.ts'),
  };
  const allowed = {
    primitives: [],
    errors: ['primitives'],
    components: ['errors', 'primitives'],
    entities: ['components', 'errors', 'primitives'],
    ports: ['entities', 'components', 'errors', 'primitives'],
    systems: ['entities', 'components', 'errors', 'primitives'],
    pipelines: [
      'systems',
      'ports',
      'entities',
      'components',
      'errors',
      'primitives',
    ],
    testing: [
      'primitives',
      'errors',
      'components',
      'entities',
      'ports',
      'systems',
      'pipelines',
    ],
  };

  it('allows exactly the tiers on the left of each production folder', () => {
    for (const [tier, path] of Object.entries(production)) {
      for (const target of Object.keys(allowed)) {
        const breach = hierarchyBreach(path, `@core/${target}`);
        const expected = allowed[tier].includes(target);
        assert.equal(
          breach === null,
          expected,
          `${tier} → @core/${target}: ${breach}`,
        );
      }
    }
  });

  it('says why: own barrel, bottom tier, upward edge, test support', () => {
    assert.match(
      hierarchyBreach(production.systems, '@core/systems'),
      /own tier barrel/,
    );
    assert.match(
      hierarchyBreach(production.primitives, '@core/components'),
      /imports nothing from the library/,
    );
    assert.match(
      hierarchyBreach(production.systems, '@core/ports'),
      /may import only @core\/entities, @core\/components, @core\/errors, @core\/primitives/,
    );
    assert.match(
      hierarchyBreach(production.components, '@core/testing'),
      /test support/,
    );
  });

  it('lets specs and type-specs import any tier but their own', () => {
    const spec = core('components/a.data.spec.ts');
    const typeSpec = core('primitives/ids.type-spec.ts');
    for (const target of ['systems', 'pipelines', 'ports', 'testing']) {
      assert.equal(hierarchyBreach(spec, `@core/${target}`), null);
      assert.equal(hierarchyBreach(typeSpec, `@core/${target}`), null);
    }
    assert.match(hierarchyBreach(spec, '@core/components'), /own tier/);
    assert.match(
      hierarchyBreach(core('testing/a.spec.ts'), '@core/testing'),
      /own tier/,
    );
  });

  it('keeps specs and type-specs leaves: nothing imports one', () => {
    const files = withFiles({
      [core('components/slot.data.ts')]:
        "import type { Minute } from '@core/primitives';\nimport { probe } from './slot.data.spec';\nexport type Slot = { readonly start: Minute };\nexport const leak = probe;\n",
      [core('components/other.data.spec.ts')]:
        "import { probe } from './slot.data.spec';\nexport const again = probe;\n",
      [core('components/types.type-spec.ts')]: 'export type T = 1;\n',
      [core('components/uses-types.data.ts')]:
        "import type { T } from './types.type-spec';\nexport type U = T;\n",
    });
    assert.match(
      leafBreach(files, core('components/slot.data.ts'), './slot.data.spec'),
      /leaf of the graph/,
    );
    assert.equal(
      leafBreach(files, core('components/slot.data.ts'), '@core/primitives'),
      null,
    );
    assert.equal(leafBreach(files, core('components/a.data.ts'), 'rxjs'), null);
    const found = checkHierarchy(snapshotOf(files));
    assert.deepEqual(where(found), [
      `${core('components/slot.data.ts')}:2`,
      `${core('components/other.data.spec.ts')}:1`,
      `${core('components/uses-types.data.ts')}:1`,
    ]);
    assert.ok(found.every(({ message }) => /src\/testing/.test(message)));
  });

  it('bans `../`, subpaths and unknown tiers everywhere in the library', () => {
    for (const path of [production.systems, core('systems/a.system.spec.ts')]) {
      assert.match(
        hierarchyBreach(path, '../components/a.data'),
        /No `\.\.\/`/,
      );
      assert.match(hierarchyBreach(path, '..'), /No `\.\.\/`/);
      // A parent segment anywhere, not only at the start.
      assert.match(
        hierarchyBreach(path, './../components/a.data'),
        /No `\.\.\/`/,
      );
      assert.match(hierarchyBreach(path, './a/../b.system'), /No `\.\.\/`/);
      assert.match(
        hierarchyBreach(path, '@core/components/a.data'),
        /never a path inside it/,
      );
      assert.match(hierarchyBreach(path, '@core/kernel'), /names no tier/);
    }
  });

  it('ignores packages, siblings and files outside the tiers', () => {
    assert.equal(hierarchyBreach(production.systems, 'rxjs'), null);
    assert.equal(hierarchyBreach(production.systems, './b.system'), null);
    assert.equal(
      hierarchyBreach('apps/web/src/main.ts', '@core/pipelines'),
      null,
    );
    assert.equal(hierarchyBreach(core('index.ts'), '../x'), null);
  });

  it('rejects a library folder that is not a tier', () => {
    const found = checkHierarchy(
      snapshotOf(
        withFiles({
          [core('utils/clamp.ts')]:
            "import { SlotSystem } from '@core/systems';\nexport const clamp = SlotSystem;\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [`${core('utils/clamp.ts')}:1`]);
    assert.match(found[0].message, /src\/utils is not a tier/);
  });

  it('reports each breach at its file and line', () => {
    const found = checkHierarchy(
      snapshotOf(
        withFiles({
          [core('components/bad.data.ts')]:
            "import type { Minute } from '@core/primitives';\nimport type { Visit } from '@core/entities';\nimport { x } from '../systems/other.system';\nexport type Bad = [Minute, Visit, typeof x];\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [
      `${core('components/bad.data.ts')}:2`,
      `${core('components/bad.data.ts')}:3`,
    ]);
    assert.ok(found.every(({ check }) => check === CHECKS.hierarchy));
  });
});

describe('(c) cycles — Tarjan over the runtime file graph', () => {
  it('finds strongly connected components', () => {
    const graph = new Map([
      ['a', [{ to: 'b', line: 1 }]],
      [
        'b',
        [
          { to: 'a', line: 1 },
          { to: 'c', line: 2 },
        ],
      ],
      ['c', []],
      ['d', [{ to: 'd', line: 1 }]],
    ]);
    const components = stronglyConnected(graph).map((component) =>
      [...component].sort(),
    );
    assert.deepEqual(components.sort(), [['a', 'b'], ['c'], ['d']]);
  });

  it('passes an acyclic library, barrels included', () => {
    assert.deepEqual(checkCycles(snapshotOf()), []);
  });

  it('resolves barrels into edges and drops type-only edges', () => {
    const graph = importGraph(snapshotOf());
    assert.deepEqual(graph.get(core('systems/index.ts')), [
      { to: core('systems/slot.system.ts'), line: 1 },
      { to: core('systems/other.system.ts'), line: 2 },
    ]);
    assert.deepEqual(graph.get(core('ports/index.ts')), []);
    assert.deepEqual(graph.get(core('testing/fixtures.ts')), [
      { to: core('systems/index.ts'), line: 1 },
      { to: core('pipelines/index.ts'), line: 3 },
    ]);
  });

  it('reports a sibling value cycle with the whole chain', () => {
    const found = checkCycles(
      snapshotOf(
        withFiles({
          [core('systems/other.system.ts')]:
            "import { SlotSystem } from './slot.system';\nexport const other = (value: number) => value + Object.keys(SlotSystem).length;\n",
        }),
      ),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].file, core('systems/other.system.ts'));
    assert.equal(found[0].line, 1);
    assert.match(
      found[0].message,
      /systems\/other\.system\.ts:1 → systems\/slot\.system\.ts:3 → systems\/other\.system\.ts/,
    );
  });

  it('does not count a type-only sibling cycle', () => {
    assert.deepEqual(
      checkCycles(
        snapshotOf(
          withFiles({
            [core('primitives/minute.primitive.ts')]:
              "import type { Length } from './length.primitive';\nexport type Minute = number & { readonly length?: Length };\n",
            [core('primitives/length.primitive.ts')]:
              "import type { Minute } from './minute.primitive';\nexport type Length = Minute;\n",
          }),
        ),
      ),
      [],
    );
  });

  it('reports a cycle that runs through two tier barrels', () => {
    const found = checkCycles(
      snapshotOf(
        withFiles({
          [core('primitives/minute.primitive.ts')]:
            "import { probe } from '@core/components';\nexport const Minute = { probe };\n",
          [core('components/slot.data.ts')]:
            "import { Minute } from '@core/primitives';\nexport const probe = 1;\nexport const Slot = { Minute };\n",
        }),
      ),
    );
    assert.equal(found.length, 1);
    assert.match(found[0].message, /through 4 file\(s\)/);
    assert.match(found[0].message, /components\/index\.ts:1/);
    assert.match(found[0].message, /primitives\/index\.ts:1/);
  });

  it('reports a file importing itself', () => {
    const found = checkCycles(
      snapshotOf(
        withFiles({
          [core('systems/other.system.ts')]:
            "import { other as self } from './other.system';\nexport const other = (value: number) => (value > 0 ? self(value - 1) : 0);\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [`${core('systems/other.system.ts')}:1`]);
  });
});

describe('(d) deep relative imports, repo-wide', () => {
  it('rejects three or more `../` in any module specifier', () => {
    const found = checkDeepRelative(
      snapshotOf(
        withFiles({
          'apps/showcase/src/app/pages/controls/x/x.page.ts':
            "import { ScPage } from '../../../shared/page';\nimport { ScDemo } from '../../shared/demo';\nconst lazy = () => import('../../../../lazy');\nconst css = resolve(__dirname, '../../../tokens.css');\nexport const page = [ScPage, ScDemo, lazy, css];\n",
          'tools/a/b/c/index.mjs': "export { default } from '../../..';\n",
          'tools/a/b/c/run.mjs':
            "const config = require('../../../config.json');\nconst root = require('../../..');\nconst sneaky = require('./../../../x');\nexport default [config, root, sneaky];\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [
      'apps/showcase/src/app/pages/controls/x/x.page.ts:1',
      'apps/showcase/src/app/pages/controls/x/x.page.ts:3',
      'tools/a/b/c/index.mjs:1',
      'tools/a/b/c/run.mjs:1',
      'tools/a/b/c/run.mjs:2',
      'tools/a/b/c/run.mjs:3',
    ]);
    assert.ok(found.every(({ check }) => check === CHECKS.deepRelative));
  });

  it('has no exception: a nested ESLint config names the root config `#eslint-config`', () => {
    const found = checkDeepRelative(
      snapshotOf(
        withFiles({
          'libs/features/admin/loyalty/eslint.config.mjs':
            "import base from '../../../../eslint.config.mjs';\nimport rules from '../../../../tools/lint-rules/index.mjs';\nexport default [...base, ...rules];\n",
          'libs/ui/patterns/eslint.config.mjs':
            "import base from '#eslint-config';\nexport default [...base];\n",
          'libs/ecs-core/eslint.config.mjs':
            "import base from '../../eslint.config.mjs';\nexport default [...base];\n",
        }),
      ),
    );
    assert.deepEqual(where(found), [
      'libs/features/admin/loyalty/eslint.config.mjs:1',
      'libs/features/admin/loyalty/eslint.config.mjs:2',
    ]);
    assert.match(found[0].message, /#eslint-config/);
  });
});

describe('(e) barrels re-export their own folder only', () => {
  it('passes re-exports and the empty-tier marker', () => {
    assert.deepEqual(checkBarrels(snapshotOf()), []);
  });

  it('rejects a missing barrel, foreign re-exports, imports and local code', () => {
    const found = checkBarrels(
      snapshotOf(
        withFiles({
          [core('pipelines/index.ts')]: null,
          [core('systems/index.ts')]: [
            "export * from './slot.system';",
            "export * from '@core/components';",
            "export * from '../components/slot.data';",
            "import { other } from './other.system';",
            'export const local = other;',
            "export * from './missing.system';",
            'export { other };',
          ].join('\n'),
        }),
      ),
    );
    assert.deepEqual(where(found), [
      `${core('systems/index.ts')}:2`,
      `${core('systems/index.ts')}:3`,
      `${core('systems/index.ts')}:4`,
      `${core('systems/index.ts')}:5`,
      `${core('systems/index.ts')}:6`,
      `${core('systems/index.ts')}:7`,
      `${core('pipelines/index.ts')}:1`,
    ]);
    assert.match(found[0].message, /outside src\/systems/);
    assert.match(found[1].message, /outside src\/systems/);
    assert.match(found[2].message, /re-exports only/);
    assert.match(found[3].message, /re-exports only/);
    assert.match(found[4].message, /resolves to no file/);
    assert.match(found[5].message, /never exports local names/);
    assert.match(found[6].message, /barrel is missing/);
  });
});

describe('(e) barrels — every exported name has one home tier', () => {
  it('collects declared, re-exported and star-exported names, values and types alike', () => {
    const files = withFiles({
      [core('components/index.ts')]:
        "export * from './slot.data';\nexport type * from './kinds.data';\nexport * as Shapes from './shapes.data';\nexport { pick as choose } from './pick.data';\n",
      [core('components/kinds.data.ts')]:
        "export type Kind = 'a';\nexport interface Shape { readonly kind: Kind }\nexport const { left, right: [first] } = { left: 1, right: [2] };\nexport function make() { return 1; }\nexport namespace Kind { export type Raw = string; }\nexport default 3;\nconst hidden = 1;\nexport { hidden as shown };\n",
      [core('components/shapes.data.ts')]: 'export const circle = 1;\n',
      [core('components/pick.data.ts')]: 'export const pick = 1;\n',
    });
    const names = exportedNames(files, core('components/index.ts'));
    assert.deepEqual([...names.keys()].sort(), [
      'Kind',
      'Shape',
      'Shapes',
      'Slot',
      'choose',
      'first',
      'left',
      'make',
      'shown',
    ]);
    assert.equal(names.get('Slot'), core('components/slot.data.ts'));
    assert.equal(names.get('Kind'), core('components/kinds.data.ts'));
    assert.equal(names.get('choose'), core('components/index.ts'));
  });

  it('passes the clean fixture', () => {
    assert.deepEqual(checkNameHomes(snapshotOf()), []);
  });

  it('rejects a type name two tiers both export, and a re-export of a lower tier', () => {
    const found = checkNameHomes(
      snapshotOf(
        withFiles({
          [core('entities/visit.entity.ts')]:
            "import type { Slot } from '@core/components';\nimport type { Minute } from '@core/primitives';\nexport type Visit = Slot & { readonly length: Minute };\n\nexport type Slot = Visit;\n",
          [core('systems/index.ts')]:
            "export * from './slot.system';\nexport { other } from './other.system';\nexport * from './minute.system';\n",
          [core('systems/minute.system.ts')]:
            "export type { Minute } from '@core/primitives';\n",
        }),
      ),
    );
    const byFile = (left, right) => left.file.localeCompare(right.file);
    found.sort(byFile);
    assert.deepEqual(where(found), [
      `${core('entities/visit.entity.ts')}:5`,
      `${core('systems/minute.system.ts')}:1`,
    ]);
    assert.match(
      found[0].message,
      /`Slot` is exported by both @core\/components/,
    );
    assert.match(found[0].message, /and @core\/entities/);
    assert.match(
      found[1].message,
      /`Minute` is exported by both @core\/primitives/,
    );
    assert.match(found[1].message, /and @core\/systems/);
    assert.ok(found.every(({ check }) => check === CHECKS.barrels));
  });
});

describe('checkLayering — all five, sorted', () => {
  it('passes the clean fixture and counts what it read', () => {
    const report = checkLayering(snapshotOf());
    assert.deepEqual(report.violations, []);
    assert.equal(report.coreFiles, 17); // the clean fixture's library files, the errors tier included
    assert.equal(report.scannedFiles, cleanFiles().size);
  });

  it('sorts violations by check, file and line, and formats file:line first', () => {
    const report = checkLayering(
      snapshotOf(
        withFiles({
          [core('index.ts')]: "export * from './systems';\n",
          [core('systems/other.system.ts')]:
            "import { Slot } from '@core/ports';\nexport const other = (value: number) => value;\nexport const probe = Slot;\n",
          'apps/web/src/a/b/c.ts':
            "import x from '../../../../x';\nexport default x;\n",
        }),
      ),
    );
    assert.deepEqual(
      report.violations.map(({ check }) => check),
      [CHECKS.entryPoints, CHECKS.hierarchy, CHECKS.deepRelative],
    );
    assert.equal(
      formatViolation(report.violations[1]).split('  ')[0],
      `${core('systems/other.system.ts')}:1`,
    );
  });
});

describe('the workspace on disk', () => {
  function writeTree(files, tsconfig) {
    const root = mkdtempSync(join(tmpdir(), 'layering-'));
    for (const [path, text] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    if (tsconfig) writeFileSync(join(root, 'tsconfig.base.json'), tsconfig);
    return root;
  }

  it('loads text files under libs/apps/tools and skips build output', () => {
    const root = writeTree(
      new Map([
        ...cleanFiles(),
        ['libs/x/node_modules/pkg/index.js', `'${LEGACY_ALIAS}';\n`],
        ['apps/web/dist/main.js', `'${LEGACY_ALIAS}';\n`],
        ['apps/web/public/logo.png', 'not text'],
        ['docs/notes.md', `${LEGACY_ALIAS}\n`],
      ]),
      tsconfigText(LAW_PATHS),
    );
    const snapshot = loadWorkspace(root);
    assert.deepEqual(
      [...snapshot.files.keys()].sort(),
      [...cleanFiles().keys()].sort(),
    );
    assert.equal(snapshot.tsconfigBase.path, 'tsconfig.base.json');
    assert.deepEqual(checkLayering(snapshot).violations, []);
  });

  it('exits 0 on a clean workspace and 1 with file:line on a broken one', () => {
    const clean = writeTree(cleanFiles(), tsconfigText(LAW_PATHS));
    const ok = spawnSync(process.execPath, [SCRIPT, `--root=${clean}`], {
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /OK — Law 8 holds/);

    const broken = writeTree(
      withFiles({
        [core('primitives/minute.primitive.ts')]:
          "import type { Slot } from '@core/components';\nexport type Minute = Slot;\n",
      }),
      null,
    );
    const failed = spawnSync(process.execPath, [SCRIPT, `--root=${broken}`], {
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.ok(
      failed.stderr.includes(
        `${core('primitives/minute.primitive.ts')}:1  ${CHECKS.hierarchy}`,
      ),
      failed.stderr,
    );
  });
});
