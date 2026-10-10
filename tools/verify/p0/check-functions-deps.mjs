#!/usr/bin/env node
/**
 * Runs only the generated-package.json check of verify-p0.mjs — no
 * emulator needed. Build first:
 *
 *   pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
 *
 * `--record` rewrites functions-deps.baseline.json from the current build
 * (an intended dependency change only; say why in the commit).
 */
import { checkFunctionsDeps, recordFunctionsDeps } from './functions-deps.mjs';

if (process.argv.includes('--record')) {
  const keys = recordFunctionsDeps();
  console.log(
    `recorded  ${keys.length} runtime dependencies: ${keys.join(', ')}`,
  );
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
