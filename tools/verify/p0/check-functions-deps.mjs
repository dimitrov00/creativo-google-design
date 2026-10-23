#!/usr/bin/env node
/**
 * Runs only the generated-package.json check of verify-p0.mjs — no
 * emulator needed. Build first:
 *
 *   pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
 *
 * The check refuses a forbidden dependency (`@angular/*`, `luxon`,
 * `@types/luxon`, `dinero.js`) before it compares the build with
 * functions-deps.baseline.json. `--record` rewrites that baseline from the
 * current build (an intended dependency change only; say why in the
 * commit) and refuses, writing nothing, when the build lists a forbidden
 * key.
 */
import { checkFunctionsDeps, recordFunctionsDeps } from './functions-deps.mjs';

if (process.argv.includes('--record')) {
  try {
    const keys = recordFunctionsDeps();
    console.log(
      `recorded  ${keys.length} runtime dependencies: ${keys.join(', ')}`,
    );
  } catch (error) {
    console.error(`FAIL  record refused\n      ${error.message}`);
    process.exit(1);
  }
} else {
  try {
    console.log(
      `pass  (f) functions package.json unchanged\n      ${checkFunctionsDeps()}`,
    );
  } catch (error) {
    console.error(
      `FAIL  (f) functions package.json unchanged\n      ${error.message}`,
    );
    process.exit(1);
  }
}
