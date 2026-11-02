#!/usr/bin/env node
// Guard: the Firestore and Storage SDKs and the phone metadata
// (libphonenumber-js) stay out of the initial web chunk, every lazy route stays
// under its ceiling and every public asset under its own (budgets.json).
//
//   pnpm nx build web -- --stats-json
//   node tools/verify/bundle/check-initial-bundle.mjs [path/to/stats.json] [--top=N]
//
// Without a path it reads dist/apps/web/browser-stats.json — the name the
// Angular 22 application builder writes — and falls back to the older
// dist/apps/web/stats.json; the report names the file it read.
//
// Reads the esbuild metafile, prints the initial files, their total and the
// top contributors by package/project, and exits 1 when any entry of
// FORBIDDEN_IN_INITIAL is in the initial closure. The byte ceiling itself is
// the builder's `initial` budget in apps/web/project.json (it fails the
// build); this guard proves WHAT is in the chunk, which a size alone cannot.
//
// A ceiling rises only in the commit that says why. Lower one when a route gets
// lighter, so the gain cannot quietly be spent again.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyseInitial,
  formatBytes,
  routeBytes,
  routesOverBudget,
} from './initial-bundle.mjs';

const args = process.argv.slice(2);
const top = Number(
  (args.find((arg) => arg.startsWith('--top=')) ?? '--top=15').slice(6),
);
const DEFAULT_STATS = [
  'dist/apps/web/browser-stats.json',
  'dist/apps/web/stats.json',
].map((path) => resolve(path));
const explicit = args.find((arg) => !arg.startsWith('--'));
const statsPath = explicit
  ? resolve(explicit)
  : (DEFAULT_STATS.find((path) => existsSync(path)) ?? DEFAULT_STATS[0]);

let metafile;
try {
  metafile = JSON.parse(readFileSync(statsPath, 'utf8'));
} catch (error) {
  console.error(
    `Cannot read ${statsPath} (${error.message}).\n` +
      'Build it first: pnpm nx build web -- --stats-json',
  );
  process.exit(2);
}

const report = analyseInitial(metafile);
if (report.files.length === 0) {
  console.error(
    `${statsPath} has no initial entry (main-*.js) — not a web build metafile?`,
  );
  process.exit(2);
}

console.log(`Initial files (${statsPath}):`);
for (const { file, bytes } of report.files) {
  console.log(`  ${file.padEnd(28)} ${formatBytes(bytes).padStart(10)}`);
}
console.log(
  `  ${'total'.padEnd(28)} ${formatBytes(report.bytes).padStart(10)}  (${report.bytes} B)`,
);
console.log(`\nTop ${top} contributors:`);
for (const { owner, bytes } of report.contributors.slice(0, top)) {
  console.log(`  ${formatBytes(bytes).padStart(10)}  ${owner}`);
}

if (report.forbidden.length > 0) {
  console.error('\nFAIL — lazy-only code is in the initial chunk:');
  for (const { label, bytes, file } of report.forbidden) {
    console.error(`  ${label}: ${formatBytes(bytes)} in ${file}`);
  }
  console.error(
    '\nA static import reached it. Firestore/Storage adapters are bound with ' +
      'provideLazyPort in apps/web/src/app/app.config.ts and loaded through ' +
      'loadFirestoreAdapters()/loadStorageAdapters(); import neither SDK nor ' +
      'an adapter module from eager code. PhoneSystem loads through a ' +
      "component-local named re-export (import('./phone-field.lazy')), never " +
      'a dynamic import of the @core/systems namespace (phase-4a §9 R10).',
  );
  process.exit(1);
}

const budgets = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'budgets.json'),
    'utf8',
  ),
);

const routes = routeBytes(metafile);
console.log('\nLazy routes, initial files included:');
for (const { route, bytes } of routes) {
  console.log(`  ${formatBytes(bytes).padStart(10)}  ${route}`);
}
const overRoutes = routesOverBudget(routes, budgets);

const publicDir = resolve('apps/web/public');
const overAssets = readdirSync(publicDir, { recursive: true })
  .map((file) => ({ file, bytes: statSync(join(publicDir, file)).size }))
  .filter(({ bytes }) => bytes > budgets.publicAssetBytes);

if (overRoutes.length > 0 || overAssets.length > 0) {
  console.error('\nFAIL — over budget (tools/verify/bundle/budgets.json):');
  for (const { route, bytes, limit } of overRoutes) {
    console.error(
      `  ${route}: ${formatBytes(bytes)}, ceiling ${formatBytes(limit)}`,
    );
  }
  for (const { file, bytes } of overAssets) {
    console.error(
      `  apps/web/public/${file}: ${formatBytes(bytes)}, ceiling ${formatBytes(budgets.publicAssetBytes)}`,
    );
  }
  process.exit(1);
}
console.log(
  '\nOK — firebase/firestore, firebase/storage and libphonenumber-js are not in the initial chunk; routes and public assets are inside their budgets.',
);
