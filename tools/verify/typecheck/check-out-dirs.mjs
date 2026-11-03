#!/usr/bin/env node
/**
 * Fails when a tsconfig under apps, libs or tools does not own its output
 * folder (see out-dirs.mjs for why). Reads files only; runs in CI's `static`
 * job on every run, because a new project's config is not "affected" for any
 * project that would test it.
 *
 *   node tools/verify/typecheck/check-out-dirs.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryProblems } from './out-dirs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { count, problems } = repositoryProblems(ROOT);

if (problems.length > 0) {
  console.error(
    `FAIL  typecheck output folders (${problems.length} of ${count} configs)`,
  );
  for (const problem of problems) console.error(`      ${problem}`);
  process.exit(1);
}
console.log(`pass  typecheck output folders: ${count} configs, each its own`);
