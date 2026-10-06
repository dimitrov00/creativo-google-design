// node --test tools/verify/bundle/initial-bundle.spec.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyseInitial,
  formatBytes,
  initialOutputs,
  ownerOf,
} from './initial-bundle.mjs';

const FIRESTORE =
  'node_modules/.pnpm/@firebase+firestore@4.16.0_@firebase+app@0.15.1/node_modules/@firebase/firestore/dist/index.esm.js';
const STORAGE =
  'node_modules/.pnpm/@firebase+storage@0.14.3_@firebase+app@0.15.1/node_modules/@firebase/storage/dist/index.esm.js';
const AUTH =
  'node_modules/.pnpm/@firebase+auth@1.12.0_@firebase+app@0.15.1/node_modules/@firebase/auth/dist/esm/index.js';

/** A metafile shaped like the Angular builder's `stats.json`. */
function metafile({
  firestoreIn = 'chunk-DATA.js',
  sharedEdge = 'dynamic-import',
} = {}) {
  const inputs = (entries) =>
    Object.fromEntries(
      entries.map(([path, bytes]) => [path, { bytesInOutput: bytes }]),
    );
  const outputs = {
    'main-ABC.js': {
      bytes: 1000,
      entryPoint: 'apps/web/src/main.ts',
      imports: [
        { path: 'chunk-SHARED.js', kind: 'import-statement' },
        { path: 'chunk-DATA.js', kind: 'dynamic-import' },
        { path: 'chunk-ROUTE.js', kind: 'dynamic-import' },
      ],
      inputs: inputs([
        ['apps/web/src/main.ts', 100],
        [AUTH, 600],
        [
          'libs/infrastructure/firestore/src/lib/booking-gateway.adapter.ts',
          300,
        ],
      ]),
    },
    'chunk-SHARED.js': {
      bytes: 200,
      imports: [{ path: 'chunk-DATA.js', kind: sharedEdge }],
      inputs: inputs([['libs/domain/kernel/src/lib/result.ts', 200]]),
    },
    'chunk-DATA.js': {
      bytes: 5000,
      imports: [],
      inputs: inputs([
        [FIRESTORE, 4000],
        [STORAGE, 500],
        ['libs/infrastructure/firestore/src/lib/firestore.adapters.ts', 0],
        ['libs/infrastructure/firestore/src/lib/profile.adapter.ts', 500],
      ]),
    },
    'chunk-ROUTE.js': {
      bytes: 700,
      imports: [],
      inputs: inputs([['libs/features/x/src/index.ts', 700]]),
    },
    'styles-XYZ.css': {
      bytes: 300,
      imports: [],
      inputs: inputs([['angular:styles/global:styles', 300]]),
    },
  };
  if (firestoreIn === 'main') {
    outputs['main-ABC.js'].inputs[FIRESTORE] = { bytesInOutput: 4000 };
  }
  return { inputs: {}, outputs };
}

describe('initialOutputs — the entries plus their static-import closure', () => {
  it('counts main, the global styles and statically imported chunks only', () => {
    assert.deepEqual(initialOutputs(metafile()), [
      'chunk-SHARED.js',
      'main-ABC.js',
      'styles-XYZ.css',
    ]);
  });

  it('follows a static edge from a static chunk into what would otherwise be lazy', () => {
    assert.deepEqual(
      initialOutputs(metafile({ sharedEdge: 'import-statement' })),
      ['chunk-DATA.js', 'chunk-SHARED.js', 'main-ABC.js', 'styles-XYZ.css'],
    );
  });
});

describe('analyseInitial — size, contributors and forbidden inputs', () => {
  it('passes a build whose Firestore and Storage only load lazily', () => {
    const report = analyseInitial(metafile());
    assert.equal(report.bytes, 1000 + 200 + 300);
    assert.deepEqual(report.forbidden, []);
    assert.deepEqual(report.contributors[0], {
      owner: '@firebase/auth',
      bytes: 600,
    });
  });

  it('flags the SDK when a static edge pulls the data chunk into the initial closure', () => {
    const labels = analyseInitial(
      metafile({ sharedEdge: 'import-statement' }),
    ).forbidden.map((hit) => hit.label);
    assert.ok(labels.includes('firebase/firestore'));
    assert.ok(labels.includes('firebase/storage'));
    assert.ok(labels.some((label) => label.startsWith('Firestore adapters')));
  });

  it('flags the SDK bundled straight into main', () => {
    const report = analyseInitial(metafile({ firestoreIn: 'main' }));
    assert.deepEqual(
      report.forbidden.map(({ label, file }) => [label, file]),
      [['firebase/firestore', 'main-ABC.js']],
    );
  });
});

describe('ownerOf — who an input belongs to', () => {
  it('names packages, scoped or not, through the pnpm store', () => {
    assert.equal(ownerOf(FIRESTORE), '@firebase/firestore');
    assert.equal(
      ownerOf(
        'node_modules/.pnpm/re2js@1.2.0/node_modules/re2js/build/index.esm.js',
      ),
      're2js',
    );
  });

  it('names workspace projects by their root', () => {
    assert.equal(
      ownerOf('libs/infrastructure/firestore/src/lib/profile.adapter.ts'),
      'libs/infrastructure/firestore',
    );
    assert.equal(
      ownerOf('libs/features/staff/dashboard/src/index.ts'),
      'libs/features/staff/dashboard',
    );
    assert.equal(ownerOf('apps/web/src/main.ts'), 'apps/web');
  });
});

describe('formatBytes — the builder’s units', () => {
  it('counts 1 kB as 1000 B, like the budgets in project.json', () => {
    assert.equal(formatBytes(954573), '954.57 kB');
    assert.equal(formatBytes(1553404), '1.55 MB');
    assert.equal(formatBytes(512), '512 B');
  });
});
