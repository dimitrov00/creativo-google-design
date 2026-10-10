#!/usr/bin/env node
// Guard: the Firestore and Storage SDKs stay out of the initial web chunk.
//
//   pnpm nx build web -- --stats-json
//   node tools/verify/bundle/check-initial-bundle.mjs [path/to/stats.json] [--top=N]
//
// Reads the esbuild metafile, prints the initial files, their total and the
// top contributors by package/project, and exits 1 when any entry of
// FORBIDDEN_IN_INITIAL is in the initial closure. The byte ceiling itself is
// the builder's `initial` budget in apps/web/project.json (it fails the
// build); this guard proves WHAT is in the chunk, which a size alone cannot.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyseInitial, formatBytes } from './initial-bundle.mjs';

const args = process.argv.slice(2);
const top = Number(
  (args.find((arg) => arg.startsWith('--top=')) ?? '--top=15').slice(6),
);
const statsPath = resolve(
  args.find((arg) => !arg.startsWith('--')) ?? 'dist/apps/web/stats.json',
);

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
      'an adapter module from eager code.',
  );
  process.exit(1);
}
console.log(
  '\nOK — firebase/firestore and firebase/storage are not in the initial chunk.',
);
